"""
pipeline.py - End-to-end pipeline: Excel → EvidencePacket → (ready for Lenses).
This is the deterministic half of the system, independent of AI.
Can be run locally for development and testing.
"""
import json
import sys
from pathlib import Path
from typing import Any

from .sheet_reader import read_workbook
from .source_mapper import build_source_refs
from .formula_plan_builder import build_formula_plan
from .metric_engine import MetricEngine
from .evidence_builder import EvidencePacketBuilder, build_chart_data_specs


def run_pipeline(
    excel_path: str,
    job_id: str,
    user_request: str = "分析台新信用卡 114 年 1-12 月市占率與排名趨勢",
    output_dir: str | None = None,
) -> dict[str, Any]:
    """
    Run the complete deterministic pipeline from Excel to frozen EvidencePacket.
    
    Args:
        excel_path: Path to input .xlsx file
        job_id: Unique job identifier
        user_request: User's analysis requirement text
        output_dir: Optional directory to write intermediate JSON files
    
    Returns:
        Dict with all pipeline outputs including frozen EvidencePacket
    """
    print(f"[Pipeline] Starting pipeline for job: {job_id}")
    results: dict[str, Any] = {}

    # ─── Step 1: Read Workbook ────────────────────────────────
    print("[Pipeline] Step 1: Reading workbook...")
    profile = read_workbook(excel_path, job_id)
    results["workbookProfile"] = profile
    print(f"  → Found {len(profile['sheets'])} sheets, {len(profile['detectedPeriods'])} periods, {len(profile['detectedEntities'])} entities")

    # ─── Step 2: Build Source Refs ────────────────────────────
    print("[Pipeline] Step 2: Building source references...")
    source_refs = build_source_refs(excel_path, profile)
    results["sourceRefs"] = source_refs
    print(f"  → Built {len(source_refs)} source references")

    # ─── Step 3: Build Formula Plan ──────────────────────────
    print("[Pipeline] Step 3: Building formula plan...")
    formula_plan = build_formula_plan(profile, user_request, job_id)
    results["formulaPlan"] = formula_plan
    print(f"  → {len(formula_plan['formulas'])} formulas, {len(formula_plan['unsupported'])} unsupported")
    for u in formula_plan["unsupported"]:
        print(f"    ⚠️  Unsupported: {u['name']} - {u['reason']}")

    # ─── Step 4: Auto-approve for local dev ──────────────────
    formula_plan["status"] = "approved"

    # ─── Step 5: Compute Metrics ─────────────────────────────
    print("[Pipeline] Step 5: Computing metrics...")
    engine = MetricEngine(source_refs, formula_plan)
    metrics = engine.compute_all()
    valid_metrics = [m for m in metrics if m["valid"]]
    invalid_metrics = [m for m in metrics if not m["valid"]]
    results["metrics"] = metrics
    print(f"  → Computed {len(metrics)} metrics ({len(valid_metrics)} valid, {len(invalid_metrics)} invalid)")

    # ─── Step 6: Build Chart Data Specs ──────────────────────
    print("[Pipeline] Step 6: Building chart data specs...")
    chart_specs = build_chart_data_specs(metrics)
    results["chartDataSpecs"] = chart_specs
    print(f"  → Built {len(chart_specs)} chart data specs")

    # ─── Step 7: Freeze Evidence Packet ──────────────────────
    print("[Pipeline] Step 7: Freezing evidence packet...")
    builder = EvidencePacketBuilder(
        job_id=job_id,
        formula_plan_id=formula_plan["planId"],
        workbook_info={
            "s3Uri": f"s3://input/{job_id}/source.xlsx",
            "sha256": profile["sourceFileHash"],
        },
    )
    builder.add_source_refs(source_refs)
    builder.add_metrics(metrics)
    builder.add_chart_data_specs(chart_specs)
    builder.add_unsupported_requests(formula_plan["unsupported"])
    
    packet = builder.freeze()
    results["evidencePacket"] = packet
    print(f"  → EvidencePacket frozen: {packet['canonicalSha256'][:16]}...")

    # ─── Step 8: Write outputs ────────────────────────────────
    if output_dir:
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        
        _write_json(out_path / "workbook-profile.json", profile)
        _write_json(out_path / "formula-plan.json", formula_plan)
        _write_json(out_path / "evidence-packet.json", packet)
        _write_json(out_path / "metrics.json", metrics)
        _write_json(out_path / "chart-data-specs.json", chart_specs)
        print(f"  → Outputs written to {out_path}")

    print("[Pipeline] ✅ Pipeline complete!")
    return results


def _write_json(path: Path, data: Any) -> None:
    """Write JSON with pretty formatting."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    # CLI usage: python -m src.pipeline <excel_path> [output_dir]
    if len(sys.argv) < 2:
        print("Usage: python -m src.pipeline <excel_path> [output_dir]")
        sys.exit(1)
    
    excel_file = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "./output"
    
    results = run_pipeline(
        excel_path=excel_file,
        job_id="local-dev-001",
        output_dir=output,
    )
    
    print(f"\nSummary:")
    print(f"  Sheets: {len(results['workbookProfile']['sheets'])}")
    print(f"  Source Refs: {len(results['sourceRefs'])}")
    print(f"  Metrics: {len(results['metrics'])}")
    print(f"  Chart Specs: {len(results['chartDataSpecs'])}")
