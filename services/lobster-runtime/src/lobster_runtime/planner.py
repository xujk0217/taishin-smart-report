"""Deterministic validation only; all presentation decisions come from the AI model."""

from __future__ import annotations

from typing import Any

from strands import tool

from .contracts import AIPlanningOutput, ValidationReport


def validate_planning_output(output: AIPlanningOutput) -> ValidationReport:
    """Validate structural integrity without choosing presentation content."""
    contract = output.prompt_contract
    deck = output.deck_plan
    metric_ids = {item.metric_id for item in contract.metrics}
    chart_ids = {item.chart_id for item in contract.charts}
    insight_ids = {item.insight_id for item in contract.insights}
    custom_ids = {item.requirement_id for item in contract.custom_requirements}
    formula_ids = {item.formula_id for item in output.formula_plan.formulas}

    referenced_metrics = {item for slide in deck.slides for item in slide.metric_ids}
    referenced_charts = {item for slide in deck.slides for item in slide.chart_ids}
    referenced_insights = {item for slide in deck.slides for item in slide.insight_ids}
    referenced_custom = {item for slide in deck.slides for item in slide.custom_requirement_ids}
    referenced_formulas = {item for slide in deck.slides for item in slide.formula_ids}
    referenced_formulas.update(item for chart in contract.charts for item in chart.formula_ids)
    referenced_formulas.update(task.formula_id for task in output.calculation_plan.tasks)
    task_ids = {task.task_id for task in output.calculation_plan.tasks}
    referenced_tasks = {item for chart in contract.charts for item in chart.calculation_task_ids}

    unknown = sorted(
        (referenced_metrics - metric_ids)
        | (referenced_charts - chart_ids)
        | (referenced_insights - insight_ids)
        | (referenced_custom - custom_ids)
        | (referenced_formulas - formula_ids)
    )
    if unknown:
        raise ValueError(f"deck references unknown requirement identifiers: {unknown}")
    if referenced_tasks - task_ids:
        raise ValueError(f"charts reference unknown calculation tasks: {sorted(referenced_tasks - task_ids)}")

    missing_required = sorted(
        {item.metric_id for item in contract.metrics if item.required} - referenced_metrics
        | {item.chart_id for item in contract.charts if item.required} - referenced_charts
        | {item.insight_id for item in contract.insights if item.required} - referenced_insights
        | {item.requirement_id for item in contract.custom_requirements} - referenced_custom
        | {item.formula_id for item in output.formula_plan.formulas if item.required} - referenced_formulas
    )
    if missing_required:
        raise ValueError(f"required planning items are not assigned to a slide: {missing_required}")

    checked_references = sum(
        len(slide.metric_ids) + len(slide.formula_ids) + len(slide.chart_ids) + len(slide.insight_ids) + len(slide.custom_requirement_ids)
        for slide in deck.slides
    )
    checked_references += sum(len(chart.formula_ids) for chart in contract.charts)
    checked_references += sum(len(chart.calculation_task_ids) for chart in contract.charts)
    checked_references += len(output.calculation_plan.tasks) * 2
    return ValidationReport(
        checked_slide_count=len(deck.slides),
        checked_references=checked_references,
        findings=[],
    )


@tool(
    name="validate-deck-plan",
    description="Validate AI-generated deck structure and references without selecting its audience, style, charts, insights, metrics, or content.",
)
def validate_deck_plan_tool(planning_output: dict[str, Any]) -> dict[str, Any]:
    """Validate schema-bound AI planning output and fail closed on invalid references."""
    output = AIPlanningOutput.model_validate(planning_output)
    return validate_planning_output(output).model_dump(mode="json")
