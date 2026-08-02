"""Tests for connecting Stage 2 planning/calculation to the PPTX agent."""

from __future__ import annotations

from lobster_runtime.contracts import AIPlanningOutput
from lobster_runtime.stage2_presentation_bridge import build_presentation_inputs

from test_adapter import planning_payload


def test_stage2_artifacts_become_traceable_presentation_inputs():
    planning_output = AIPlanningOutput.model_validate(planning_payload())
    calculation_artifact = {
        "artifact_version": "calculation-artifact-v1",
        "execution_id": "calc-execution-1",
        "tasks": [{
            "task_id": "calc1",
            "metric_id": "m1",
            "formula_id": "f1",
            "rows": [
                {"category": "完成", "value": 80.0, "unit": "%", "calculation_steps": "computed from workbook"},
                {"category": "未完成", "value": 20.0, "unit": "%", "calculation_steps": "computed from workbook"},
            ],
            "warnings": [],
        }],
    }

    blueprint, evidence = build_presentation_inputs(planning_output, calculation_artifact)

    assert blueprint.title == planning_output.deck_plan.title
    assert len(blueprint.slides) == planning_output.deck_plan.total_pages
    assert evidence.metrics[0].metric_id == "m1"
    assert evidence.metrics[0].source_refs == [
        "activity.xlsx/活動紀錄/完成狀態",
        "activity.xlsx/活動紀錄/學生編號",
    ]
    assert evidence.charts[0].chart_id == "c1"
    assert evidence.charts[0].categories == ["完成", "未完成"]
    assert evidence.charts[0].series[0].values == [80.0, 20.0]
    assert any(element.chart_ref == "c1" for slide in blueprint.slides for element in slide.elements)
