"""Production Fargate entry point for real Prompt and workbook planning."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from openpyxl import load_workbook
from strands.models import BedrockModel

from .adapter import StrandsLobsterRuntimeAdapter

MAX_PROFILE_ROWS = 20
MAX_PROFILE_COLUMNS = 50
MAX_CELL_TEXT = 240


def profile_workbook(path: Path, upload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    workbook = load_workbook(path, read_only=True, data_only=True, keep_links=False)
    sheets: list[dict[str, Any]] = []
    references: list[dict[str, str]] = []
    try:
        for sheet in workbook.worksheets[:30]:
            rows: list[list[Any]] = []
            for row_index, row in enumerate(sheet.iter_rows(max_row=MAX_PROFILE_ROWS, max_col=MAX_PROFILE_COLUMNS), start=1):
                values = []
                for column_index, cell in enumerate(row, start=1):
                    value = cell.value
                    if isinstance(value, str):
                        value = value[:MAX_CELL_TEXT]
                    values.append(value)
                    if value not in (None, "") and len(references) < 500:
                        references.append({
                            "uploadId": upload["uploadId"], "fileName": upload["fileName"],
                            "sheetName": sheet.title, "cellRange": cell.coordinate,
                        })
                rows.append(values)
            sheets.append({
                "sheet_name": sheet.title, "max_rows_reported": sheet.max_row,
                "max_columns_reported": sheet.max_column, "sample_rows": rows,
            })
    finally:
        workbook.close()
    return {"upload_id": upload["uploadId"], "file_name": upload["fileName"], "sheets": sheets}, references


def run(job_id: str, operation: str) -> None:
    table = boto3.resource("dynamodb").Table(required_env("PLANNER_TABLE"))
    s3 = boto3.client("s3", config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}))
    item = table.get_item(Key={"jobId": job_id}, ConsistentRead=True).get("Item")
    if not item:
        raise RuntimeError("JOB_NOT_FOUND")
    expected_status = "QUEUED" if operation == "CREATE" else "REVISION_QUEUED"
    table.update_item(
        Key={"jobId": job_id},
        UpdateExpression="SET #status = :running, updatedAt = :now REMOVE safeErrorCode",
        ConditionExpression="#status = :expected",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":running": "RUNNING", ":expected": expected_status, ":now": utc_now()},
    )

    try:
        uploads = json.loads(item["uploadManifestJson"])
        profiles: list[dict[str, Any]] = []
        references: list[dict[str, str]] = []
        with tempfile.TemporaryDirectory(prefix="planner-") as directory:
            for upload in uploads:
                target = Path(directory) / f"{upload['uploadId']}.xlsx"
                s3.download_file(required_env("PLANNER_INPUT_BUCKET"), upload["objectKey"], str(target))
                profile, workbook_references = profile_workbook(target, upload)
                profiles.append(profile)
                references.extend(workbook_references)

        request = item["prompt"]
        previous_planning_output: dict[str, Any] | None = None
        if operation == "REVISE":
            request += "\n\n使用者對上一版完整計畫的修改要求：\n" + item.get("revisionInstruction", "")
            if item.get("planningOutputJson"):
                previous_planning_output = json.loads(item["planningOutputJson"])
        model = BedrockModel(
            model_id=required_env("BEDROCK_MODEL_ID"), region_name=required_env("AWS_REGION"),
            temperature=0.1, max_tokens=12000,
            boto_client_config=Config(connect_timeout=10, read_timeout=600, retries={"max_attempts": 2, "mode": "standard"}),
        )
        plan = StrandsLobsterRuntimeAdapter(model).plan(
            request,
            workbook_context=profiles,
            previous_planning_output=previous_planning_output,
        )
        current_version = int(item.get("planVersion", 0))
        table.update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #status = :review, planVersion = :version, planningOutputJson = :output, sourceReferencesJson = :refs, updatedAt = :now REMOVE revisionInstruction",
            ConditionExpression="#status = :running",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":review": "NEEDS_REVIEW", ":running": "RUNNING", ":version": current_version + 1,
                ":output": plan.planning_output.model_dump_json(), ":refs": json.dumps(references, ensure_ascii=False), ":now": utc_now(),
            },
        )
    except Exception as error:
        safe_error_code = (
            "PLAN_OUTPUT_TOO_LARGE"
            if type(error).__name__ == "MaxTokensReachedException"
            else "PLANNING_FAILED"
        )
        print(json.dumps({"level": "error", "jobId": job_id, "code": type(error).__name__}))
        table.update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET #status = :failed, safeErrorCode = :code, updatedAt = :now",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":failed": "FAILED", ":code": safe_error_code, ":now": utc_now()},
        )


def utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"MISSING_{name}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", default=os.environ.get("PLANNER_JOB_ID"))
    parser.add_argument("--operation", choices=["CREATE", "REVISE"], default=os.environ.get("PLANNER_OPERATION"))
    arguments = parser.parse_args()
    if not arguments.job_id or not arguments.operation:
        parser.error("job id and operation are required")
    run(arguments.job_id, arguments.operation)


if __name__ == "__main__":
    main()
