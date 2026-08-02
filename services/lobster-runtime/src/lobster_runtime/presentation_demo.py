"""Real Strands/Bedrock demo runner for agent-generated PPTX artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .presentation_worker import run


def default_blueprint() -> dict[str, Any]:
    return {
        "blueprint_version": "presentation-blueprint-v1",
        "title": "Agent 生成簡報 Demo",
        "slides": [
            {
                "slide_id": "s1",
                "role": "cover",
                "intent": "建立報告主題與決策脈絡",
                "layout_strategy": "template-aware cover with concise title and evidence-backed claim",
                "elements": [
                    {"element_id": "s1_title", "type": "title", "box": {"x": 0.7, "y": 0.7, "w": 10.8, "h": 0.8}, "text": "Agent 生成簡報 Demo"},
                    {"element_id": "s1_claim", "type": "claim", "box": {"x": 0.9, "y": 1.9, "w": 8.8, "h": 1.1}, "claim_ref": "claim_total_summary"},
                ],
            },
            {
                "slide_id": "s2",
                "role": "content",
                "intent": "用可編輯圖表與 KPI 卡呈現主要分布",
                "layout_strategy": "metric card plus editable column chart and compact table",
                "elements": [
                    {"element_id": "s2_title", "type": "title", "box": {"x": 0.7, "y": 0.4, "w": 10.0, "h": 0.6}, "text": "區域表現比較"},
                    {"element_id": "s2_metric", "type": "metricCard", "box": {"x": 0.7, "y": 1.2, "w": 2.7, "h": 1.0}, "metric_ref": "metric_total_revenue"},
                    {"element_id": "s2_chart", "type": "chart", "box": {"x": 0.7, "y": 2.5, "w": 6.2, "h": 3.6}, "chart_ref": "chart_region_revenue"},
                    {"element_id": "s2_table", "type": "table", "box": {"x": 7.3, "y": 2.5, "w": 4.8, "h": 2.6}, "table_ref": "table_region_revenue"},
                ],
            },
            {
                "slide_id": "s3",
                "role": "back-cover",
                "intent": "收束行動建議",
                "layout_strategy": "simple closing slide with non-numeric action text",
                "elements": [
                    {"element_id": "s3_title", "type": "title", "box": {"x": 0.7, "y": 0.7, "w": 10.8, "h": 0.8}, "text": "後續行動"},
                    {"element_id": "s3_text", "type": "text", "box": {"x": 0.9, "y": 1.9, "w": 8.0, "h": 1.1}, "text": "請依據已驗證資料安排資源與追蹤節奏。"},
                ],
            },
        ],
    }


def default_evidence() -> dict[str, Any]:
    return {
        "packet_id": "evp-real-agent-demo-v2",
        "metrics": [
            {
                "metric_id": "metric_total_revenue",
                "label": "總營收",
                "value": 1250000,
                "unit": "元",
                "display_format": "currency",
                "source_refs": ["demo.xlsx#Region!B2:B4"],
                "calculation": "sum revenue by region from the approved demo input table",
            }
        ],
        "charts": [
            {
                "chart_id": "chart_region_revenue",
                "title": "區域營收",
                "chart_type": "column",
                "categories": ["北區", "中區", "南區"],
                "series": [{"name": "營收", "values": [600000, 350000, 300000]}],
                "metric_refs": ["metric_total_revenue"],
            }
        ],
        "claims": [
            {
                "claim_id": "claim_total_summary",
                "text": "本期總營收為 {{metric_total_revenue}}，區域表現呈現集中於主要市場的型態。",
                "metric_refs": ["metric_total_revenue"],
                "chart_refs": ["chart_region_revenue"],
                "source_refs": ["demo.xlsx#Region!B2:B4"],
            }
        ],
        "tables": [
            {
                "table_id": "table_region_revenue",
                "title": "區域營收資料",
                "headers": ["區域", "營收"],
                "rows": [["北區", 600000], ["中區", 350000], ["南區", 300000]],
                "source_refs": ["demo.xlsx#Region!B2:B4"],
            }
        ],
    }


def write_default_inputs(directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    blueprint_path = directory / "demo-blueprint.json"
    evidence_path = directory / "demo-evidence.json"
    blueprint_path.write_text(json.dumps(default_blueprint(), ensure_ascii=False, indent=2), encoding="utf-8")
    evidence_path.write_text(json.dumps(default_evidence(), ensure_ascii=False, indent=2), encoding="utf-8")
    return blueprint_path, evidence_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run real Strands/Bedrock agent generation for PPTX/XLSX.")
    parser.add_argument("--prompt", default="請依據提供的 blueprint 與 evidence 生成一份可編輯、套用模板風格且可追溯的 PowerPoint 簡報。")
    parser.add_argument("--blueprint")
    parser.add_argument("--evidence")
    parser.add_argument("--template")
    parser.add_argument("--output-dir", default="/tmp/agent-presentation-demo")
    parser.add_argument("--file-stem", default="real-agent-presentation")
    arguments = parser.parse_args()

    output_dir = Path(arguments.output_dir)
    if arguments.blueprint and arguments.evidence:
        blueprint_path = Path(arguments.blueprint)
        evidence_path = Path(arguments.evidence)
    else:
        blueprint_path, evidence_path = write_default_inputs(output_dir / "inputs")

    result = run(
        prompt=arguments.prompt,
        blueprint_path=blueprint_path,
        evidence_path=evidence_path,
        output_dir=output_dir,
        template_path=arguments.template,
        file_stem=arguments.file_stem,
    )
    print(json.dumps({
        "mode": "REAL_STRANDS_AGENT",
        "blueprintPath": str(blueprint_path),
        "evidencePath": str(evidence_path),
        "pptxPath": result["manifest"]["pptx_path"],
        "xlsxPath": result["manifest"]["xlsx_path"],
        "validationStatus": result["validation_report"]["status"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
