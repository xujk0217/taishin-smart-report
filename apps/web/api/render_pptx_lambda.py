"""AWS Lambda adapter for the shared python-pptx renderer.

For a saved project the browser sends only its job ID.  This function checks
the Cognito owner and reads that project's private PPTX template from S3.  A
base64 template remains available only for the local fallback and backwards
compatibility.  It never reads a workbook: chart values are calculation output.
"""
from __future__ import annotations

import base64
import binascii
import importlib.util
import io
import json
import os
from pathlib import Path
from typing import Any

import boto3


_renderer_path = Path(__file__).with_name("render-pptx.py")
_renderer_spec = importlib.util.spec_from_file_location("smart_report_renderer", _renderer_path)
if _renderer_spec is None or _renderer_spec.loader is None:
    raise RuntimeError("RENDERER_MODULE_UNAVAILABLE")
_renderer = importlib.util.module_from_spec(_renderer_spec)
_renderer_spec.loader.exec_module(_renderer)

MAX_TEMPLATE_BYTES = 6 * 1024 * 1024
MAX_RENDERED_BYTES = 7 * 1024 * 1024
MAX_SLIDES = 50


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        if event.get("httpMethod") != "POST":
            return _json_response(405, {"code": "METHOD_NOT_ALLOWED"})
        body = _decode_json_body(event)
        template = _decode_template(body.get("template")) if body.get("template") else _load_saved_template(event, body.get("jobId"))
        spec = body.get("spec")
        data = body.get("data", {})
        if not isinstance(spec, list) or not spec or len(spec) > MAX_SLIDES:
            return _json_response(400, {"code": "INVALID_SLIDE_SPEC"})
        if not isinstance(data, dict):
            return _json_response(400, {"code": "INVALID_RENDER_DATA"})

        presentation = _renderer.Presentation(io.BytesIO(template))
        renderer = _renderer.handler.__new__(_renderer.handler)
        output = renderer._render(presentation, spec, data)
        if len(output) > MAX_RENDERED_BYTES:
            return _json_response(413, {"code": "RENDERED_PPTX_TOO_LARGE"})
        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "content-disposition": 'attachment; filename="report.pptx"',
                "cache-control": "no-store",
                "access-control-allow-origin": os.environ.get("UI_ORIGIN", ""),
                "vary": "Origin",
            },
            "isBase64Encoded": True,
            "body": base64.b64encode(output).decode("ascii"),
        }
    except ValueError as error:
        return _json_response(400, {"code": str(error)})
    except Exception:
        # Do not disclose workbook or template internals to the browser.
        return _json_response(500, {"code": "PPTX_RENDER_FAILED"})


def _decode_json_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    decoded = json.loads(body)
    if not isinstance(decoded, dict):
        raise ValueError("INVALID_RENDER_REQUEST")
    return decoded


def _decode_template(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("PPTX_TEMPLATE_REQUIRED")
    try:
        template = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("INVALID_PPTX_TEMPLATE") from error
    if not template.startswith(b"PK"):
        raise ValueError("INVALID_PPTX_TEMPLATE")
    if len(template) > MAX_TEMPLATE_BYTES:
        raise ValueError("PPTX_TEMPLATE_TOO_LARGE")
    return template


def _load_saved_template(event: dict[str, Any], job_id: Any) -> bytes:
    if not isinstance(job_id, str) or not job_id:
        raise ValueError("PPTX_TEMPLATE_REQUIRED")
    owner_sub = (((event.get("requestContext") or {}).get("authorizer") or {}).get("claims") or {}).get("sub")
    if not isinstance(owner_sub, str) or not owner_sub:
        raise ValueError("AUTHENTICATION_REQUIRED")
    table_name = os.environ.get("PLANNER_TABLE")
    bucket = os.environ.get("PLANNER_INPUT_BUCKET")
    if not table_name or not bucket:
        raise RuntimeError("PPTX_TEMPLATE_STORAGE_UNAVAILABLE")
    item = boto3.resource("dynamodb").Table(table_name).get_item(Key={"jobId": job_id}, ConsistentRead=True).get("Item")
    if not item or item.get("ownerSub") != owner_sub:
        raise ValueError("PPTX_TEMPLATE_NOT_FOUND")
    try:
        manifest = json.loads(item.get("uploadManifestJson", "[]"))
        template = next((entry for entry in manifest if entry.get("kind") == "template"), None)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("PPTX_TEMPLATE_NOT_FOUND") from error
    if not isinstance(template, dict) or not isinstance(template.get("objectKey"), str):
        raise ValueError("PPTX_TEMPLATE_NOT_FOUND")
    response = boto3.client("s3").get_object(Bucket=bucket, Key=template["objectKey"])
    body = response["Body"].read(MAX_TEMPLATE_BYTES + 1)
    if not body.startswith(b"PK"):
        raise ValueError("INVALID_PPTX_TEMPLATE")
    if len(body) > MAX_TEMPLATE_BYTES:
        raise ValueError("PPTX_TEMPLATE_TOO_LARGE")
    return body


def _json_response(status_code: int, body: dict[str, str]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
            "access-control-allow-origin": os.environ.get("UI_ORIGIN", ""),
            "vary": "Origin",
        },
        "body": json.dumps(body),
    }
