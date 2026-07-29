"""
workbook_validator.py - Validates workbook structure completeness.
Checks required sheets, fields, and data formats.
"""
from typing import Any


def validate_workbook(profile: dict[str, Any]) -> dict[str, Any]:
    """
    Validate WorkbookProfile for completeness and correctness.
    
    Returns:
        ValidationResult dict with passed, findings, blocking_count
    """
    findings: list[dict[str, Any]] = []
    finding_counter = 0

    # Check we have at least one sheet
    if not profile.get("sheets"):
        finding_counter += 1
        findings.append(_finding(
            finding_counter, "WORKBOOK_NO_SHEETS", "blocking",
            "ValidateWorkbook", "Excel 檔案中未偵測到任何工作表",
            recoverable=False
        ))
        return _result(findings)

    # Check each sheet has data
    for sheet in profile["sheets"]:
        if sheet["dataEndRow"] <= sheet["dataStartRow"]:
            finding_counter += 1
            findings.append(_finding(
                finding_counter, "SHEET_NO_DATA", "warning",
                "ValidateWorkbook",
                f"工作表 '{sheet['sheetName']}' 未偵測到有效資料列",
                details={"sheetName": sheet["sheetName"]},
                recoverable=True
            ))

        # Check columns exist
        if not sheet.get("columns") or len(sheet["columns"]) < 2:
            finding_counter += 1
            findings.append(_finding(
                finding_counter, "SHEET_INSUFFICIENT_COLUMNS", "blocking",
                "ValidateWorkbook",
                f"工作表 '{sheet['sheetName']}' 欄位數不足（至少需要2欄）",
                details={"sheetName": sheet["sheetName"], "columnCount": len(sheet.get("columns", []))},
                recoverable=False
            ))

    # Check detected periods
    if not profile.get("detectedPeriods"):
        finding_counter += 1
        findings.append(_finding(
            finding_counter, "NO_PERIODS_DETECTED", "blocking",
            "ValidateWorkbook",
            "未偵測到任何有效期間欄位（需要 YYMM 格式如 11401）",
            recoverable=False
        ))

    # Check detected entities
    if not profile.get("detectedEntities"):
        finding_counter += 1
        findings.append(_finding(
            finding_counter, "NO_ENTITIES_DETECTED", "warning",
            "ValidateWorkbook",
            "未偵測到任何銀行/實體名稱",
            recoverable=True
        ))

    return _result(findings)


def _finding(
    counter: int,
    error_type: str,
    severity: str,
    stage: str,
    message: str,
    details: dict | None = None,
    recoverable: bool = False,
    suggested_action: str | None = None,
) -> dict[str, Any]:
    return {
        "findingId": f"finding-{counter:04d}",
        "errorType": error_type,
        "severity": severity,
        "stage": stage,
        "message": message,
        "details": details or {},
        "recoverable": recoverable,
        "suggestedAction": suggested_action,
    }


def _result(findings: list[dict[str, Any]]) -> dict[str, Any]:
    blocking = sum(1 for f in findings if f["severity"] == "blocking")
    return {
        "passed": blocking == 0,
        "findings": findings,
        "blockingCount": blocking,
    }
