"""CLI entry point for agent-generated python-pptx presentations."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from botocore.config import Config
from strands.models import BedrockModel

from .presentation_agent import AgentPresentationRuntime


def read_json(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def run(
    *,
    prompt: str,
    blueprint_path: str | Path,
    evidence_path: str | Path,
    output_dir: str | Path,
    template_path: str | Path | None = None,
    file_stem: str = "agent-generated-presentation",
) -> dict[str, Any]:
    model = BedrockModel(
        model_id=required_env("BEDROCK_MODEL_ID"),
        region_name=required_env("AWS_REGION"),
        temperature=0.1,
        max_tokens=int(os.environ.get("BEDROCK_MAX_TOKENS", "9000")),
        boto_client_config=Config(connect_timeout=10, read_timeout=600, retries={"max_attempts": 2, "mode": "standard"}),
    )
    result = AgentPresentationRuntime(model).generate(
        prompt=prompt,
        blueprint=read_json(blueprint_path),
        evidence=read_json(evidence_path),
        output_dir=output_dir,
        template_path=template_path,
        file_stem=file_stem,
    )
    report_path = Path(output_dir) / f"{file_stem}.validation.json"
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(result.model_dump(mode="json"), handle, ensure_ascii=False, indent=2)
    return result.model_dump(mode="json")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"MISSING_{name}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--blueprint", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--template")
    parser.add_argument("--file-stem", default="agent-generated-presentation")
    arguments = parser.parse_args()
    result = run(
        prompt=arguments.prompt,
        blueprint_path=arguments.blueprint,
        evidence_path=arguments.evidence,
        output_dir=arguments.output_dir,
        template_path=arguments.template,
        file_stem=arguments.file_stem,
    )
    print(json.dumps({
        "pptxPath": result["manifest"]["pptx_path"],
        "xlsxPath": result["manifest"]["xlsx_path"],
        "validationStatus": result["validation_report"]["status"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
