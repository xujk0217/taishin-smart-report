"""
formula_plan_builder.py - Generates formula plan from user request and available data.
Automatically detects which metrics can be computed and marks unsupported ones.
"""
from typing import Any


def build_formula_plan(
    profile: dict[str, Any],
    user_request: str,
    job_id: str,
) -> dict[str, Any]:
    """
    Build a formula plan based on available data and user request.
    
    Args:
        profile: WorkbookProfile from sheet_reader
        user_request: User's analysis requirement text
        job_id: Job identifier
    
    Returns:
        FormulaPlan dict
    """
    available_sheets = {s["sheetName"] for s in profile["sheets"]}
    available_periods = set(profile["detectedPeriods"])
    
    formulas = []
    unsupported = []
    assumptions = [
        "期間格式為民國年月 (11401=114年1月)",
        "金額單位為新台幣百萬元",
        "市占率以全體銀行為分母計算",
        "排名依數值由大至小排列",
    ]

    # ─── Standard formulas for credit card statistics ─────────

    # Market share (簽帳金額市占率)
    for sheet_info in profile["sheets"]:
        sheet_name = sheet_info["sheetName"]
        
        # Detect if this sheet has amount data suitable for market share
        if _sheet_has_numeric_data(sheet_info):
            formula_id = f"formula-share-{_sanitize(sheet_name)}"
            formulas.append({
                "formulaId": formula_id,
                "name": f"{sheet_name}市占率",
                "definition": "entity_value / total_value * 100",
                "inputs": [
                    {"field": sheet_name, "sheet": sheet_name, "entity": "各銀行"},
                ],
                "unit": "percent",
                "displayFormat": "##.##%",
                "supported": True,
            })

            # MoM growth
            if len(available_periods) >= 2:
                formulas.append({
                    "formulaId": f"formula-mom-{_sanitize(sheet_name)}",
                    "name": f"{sheet_name}月增率",
                    "definition": "(current_value - previous_value) / previous_value * 100",
                    "inputs": [
                        {"field": sheet_name, "sheet": sheet_name, "entity": "各銀行"},
                    ],
                    "unit": "percent",
                    "displayFormat": "+##.##%",
                    "supported": True,
                })

    # ─── YoY detection: Check if we have year 113 data ────────
    has_year_113 = any(p.startswith("113") for p in available_periods)
    has_year_114 = any(p.startswith("114") for p in available_periods)
    
    if has_year_114 and not has_year_113:
        unsupported.append({
            "name": "年增率 (YoY)",
            "reason": "缺少 113 年同期資料，無法計算年增率",
            "wouldRequire": ["11301-11312 各指標資料"],
        })
    elif has_year_114 and has_year_113:
        for sheet_info in profile["sheets"]:
            if _sheet_has_numeric_data(sheet_info):
                sheet_name = sheet_info["sheetName"]
                formulas.append({
                    "formulaId": f"formula-yoy-{_sanitize(sheet_name)}",
                    "name": f"{sheet_name}年增率",
                    "definition": "(current_year_value - previous_year_value) / previous_year_value * 100",
                    "inputs": [
                        {"field": sheet_name, "sheet": sheet_name, "entity": "各銀行"},
                    ],
                    "unit": "percent",
                    "displayFormat": "+##.##%",
                    "supported": True,
                })

    return {
        "planId": f"plan-{job_id}-v1",
        "jobId": job_id,
        "formulas": formulas,
        "unsupported": unsupported,
        "assumptions": assumptions,
        "version": 1,
        "status": "pending_approval",
    }


def _sheet_has_numeric_data(sheet_info: dict[str, Any]) -> bool:
    """Check if a sheet likely contains numeric data (has period columns)."""
    from .normalizer import normalize_period
    for col in sheet_info.get("columns", []):
        if normalize_period(col):
            return True
    return False


def _sanitize(name: str) -> str:
    """Sanitize a name for use as an ID component."""
    import re
    return re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]', '-', name).strip('-')
