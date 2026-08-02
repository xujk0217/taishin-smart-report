"""Bridge Stage 2 planning/calculation artifacts into presentation-agent inputs."""

from __future__ import annotations

from typing import Any

from .contracts import AIPlanningOutput, CalculationTask, ChartRequirement, SlidePlan
from .presentation_contracts import (
    BlueprintElement,
    BlueprintSlide,
    Box,
    ChartData,
    ChartSeries,
    ClaimRecord,
    EvidenceMetric,
    EvidencePacketV2,
    PresentationBlueprint,
    TableData,
)


def build_presentation_inputs(
    planning_output: AIPlanningOutput,
    calculation_artifact: dict[str, Any],
) -> tuple[PresentationBlueprint, EvidencePacketV2]:
    """Create renderer blueprint/evidence from the approved Stage 2 artifacts.

    Stage 2 owns semantic planning and deterministic calculations.  The
    presentation agent receives only this compact, traceable projection so it
    can focus on python-pptx layout and template reuse without re-discovering
    numbers or workbook bindings.
    """
    evidence = _build_evidence(planning_output, calculation_artifact)
    blueprint = _build_blueprint(planning_output, evidence)
    return blueprint, evidence


def _build_evidence(planning_output: AIPlanningOutput, artifact: dict[str, Any]) -> EvidencePacketV2:
    task_results = {
        str(task.get("task_id")): task
        for task in artifact.get("tasks", [])
        if isinstance(task, dict) and task.get("task_id")
    }
    tasks_by_id = {task.task_id: task for task in planning_output.calculation_plan.tasks}
    metrics_by_id = {metric.metric_id: metric for metric in planning_output.prompt_contract.metrics}
    formulas_by_id = {formula.formula_id: formula for formula in planning_output.formula_plan.formulas}

    metrics: list[EvidenceMetric] = []
    for task in planning_output.calculation_plan.tasks:
        result = task_results.get(task.task_id)
        metric_requirement = metrics_by_id.get(task.output_metric_id)
        if not result or metric_requirement is None:
            continue
        value = _first_numeric(result.get("rows", []), preferred_fields=task.output_fields)
        if value is None:
            continue
        formula = formulas_by_id.get(task.formula_id)
        unit = _unit_for(task, result, formula.output_unit if formula else "")
        metrics.append(EvidenceMetric(
            metric_id=task.output_metric_id,
            label=metric_requirement.name,
            value=value,
            unit=unit,
            display_format=_display_format(unit, value),
            source_refs=_source_refs(task),
            calculation=formula.expression if formula else task.objective,
        ))

    charts: list[ChartData] = []
    for chart in planning_output.prompt_contract.charts:
        chart_data = _chart_data_for(chart, tasks_by_id, task_results)
        if chart_data is not None:
            charts.append(chart_data)

    claims: list[ClaimRecord] = []
    for slide in planning_output.deck_plan.slides:
        text = _claim_text(slide)
        claims.append(ClaimRecord(
            claim_id=f"claim_slide_{slide.page_number}",
            text=text,
            metric_refs=[metric_id for metric_id in slide.metric_ids if metric_id in {m.metric_id for m in metrics}],
            chart_refs=[chart_id for chart_id in slide.chart_ids if chart_id in {c.chart_id for c in charts}],
            source_refs=slide.evidence_requirements,
        ))
    for insight in planning_output.prompt_contract.insights:
        claims.append(ClaimRecord(
            claim_id=insight.insight_id,
            text=insight.question,
            metric_refs=[],
            chart_refs=[],
            source_refs=insight.evidence_needed,
        ))

    tables: list[TableData] = []
    for task in planning_output.calculation_plan.tasks:
        result = task_results.get(task.task_id)
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if not rows:
            continue
        headers = _table_headers(rows, task.output_fields)
        table_rows = [[_cell_value(row.get(header)) for header in headers] for row in rows[:12] if isinstance(row, dict)]
        if headers and table_rows:
            tables.append(TableData(
                table_id=f"table_{task.task_id}",
                title=task.objective,
                headers=headers,
                rows=table_rows,
                source_refs=_source_refs(task),
            ))

    return EvidencePacketV2(
        packet_id=f"stage2-{artifact.get('execution_id', 'calculation')}",
        metrics=metrics,
        charts=charts,
        claims=claims,
        tables=tables,
    )


def _build_blueprint(planning_output: AIPlanningOutput, evidence: EvidencePacketV2) -> PresentationBlueprint:
    metric_ids = {metric.metric_id for metric in evidence.metrics}
    chart_ids = {chart.chart_id for chart in evidence.charts}
    table_ids = {table.table_id for table in evidence.tables}
    slides: list[BlueprintSlide] = []
    for slide in planning_output.deck_plan.slides:
        elements: list[BlueprintElement] = [
            BlueprintElement(
                element_id=f"s{slide.page_number}_title",
                type="title",
                box=Box(x=0.65, y=0.45, w=11.8, h=0.65),
                text=slide.title,
            ),
            BlueprintElement(
                element_id=f"s{slide.page_number}_claim",
                type="claim",
                box=Box(x=0.75, y=1.2, w=10.8, h=0.85),
                claim_ref=f"claim_slide_{slide.page_number}",
            ),
        ]
        for index, metric_id in enumerate([item for item in slide.metric_ids if item in metric_ids][:3]):
            elements.append(BlueprintElement(
                element_id=f"s{slide.page_number}_metric_{index + 1}",
                type="metricCard",
                box=Box(x=0.75 + index * 3.0, y=2.05, w=2.65, h=0.95),
                metric_ref=metric_id,
            ))
        first_chart = next((chart_id for chart_id in slide.chart_ids if chart_id in chart_ids), None)
        if first_chart:
            elements.append(BlueprintElement(
                element_id=f"s{slide.page_number}_chart",
                type="chart",
                box=Box(x=0.75, y=3.05, w=7.0, h=3.55),
                chart_ref=first_chart,
            ))
        first_table = _table_for_slide(slide, table_ids)
        if first_table:
            elements.append(BlueprintElement(
                element_id=f"s{slide.page_number}_table",
                type="table",
                box=Box(x=8.0, y=3.05, w=4.55, h=2.7),
                table_ref=first_table,
            ))
        if len(elements) == 2 and slide.content_elements:
            elements.append(BlueprintElement(
                element_id=f"s{slide.page_number}_text",
                type="text",
                box=Box(x=0.75, y=2.2, w=10.8, h=2.6),
                text="\n".join(slide.content_elements[:5]),
            ))
        slides.append(BlueprintSlide(
            slide_id=f"slide_{slide.page_number}",
            role=slide.kind,
            intent=slide.communication_goal,
            layout_strategy=slide.layout_guidance or "Use the uploaded template's closest editable layout.",
            elements=elements,
        ))
    return PresentationBlueprint(title=planning_output.deck_plan.title, slides=slides)


def _chart_data_for(
    chart: ChartRequirement,
    tasks_by_id: dict[str, CalculationTask],
    task_results: dict[str, dict[str, Any]],
) -> ChartData | None:
    for task_id in chart.calculation_task_ids:
        task = tasks_by_id.get(task_id)
        result = task_results.get(task_id)
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if task is None or not rows:
            continue
        points = _points_from_rows(rows, task.output_fields)
        if not points:
            continue
        return ChartData(
            chart_id=chart.chart_id,
            title=chart.title,
            chart_type=_chart_type(chart.visualization),
            categories=[label for label, _value in points],
            series=[ChartSeries(name=chart.title, values=[value for _label, value in points])],
            metric_refs=[task.output_metric_id],
        )
    return None


def _points_from_rows(rows: Any, preferred_fields: list[str]) -> list[tuple[str, float]]:
    points: list[tuple[str, float]] = []
    if not isinstance(rows, list):
        return points
    for index, row in enumerate(rows[:18]):
        if not isinstance(row, dict):
            continue
        value = _first_numeric([row], preferred_fields=preferred_fields)
        if value is None:
            continue
        label = _label_for_row(row, index, preferred_fields)
        points.append((label, value))
    return points


def _first_numeric(rows: Any, *, preferred_fields: list[str]) -> float | None:
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        for field in preferred_fields:
            number = _as_float(row.get(field))
            if number is not None:
                return number
        for value in row.values():
            number = _as_float(value)
            if number is not None:
                return number
    return None


def _unit_for(task: CalculationTask, result: dict[str, Any], formula_unit: str) -> str:
    rows = result.get("rows", [])
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("unit"), str):
                return str(row["unit"])
    return formula_unit


def _label_for_row(row: dict[str, Any], index: int, value_fields: list[str]) -> str:
    for key, value in row.items():
        if key in value_fields:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()[:80]
    return f"資料列 {index + 1}"


def _table_headers(rows: Any, preferred_fields: list[str]) -> list[str]:
    if not isinstance(rows, list):
        return []
    seen: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for field in [*preferred_fields, *row.keys()]:
            if field in row and field not in seen:
                seen.append(str(field))
        if seen:
            return seen[:8]
    return []


def _table_for_slide(slide: SlidePlan, table_ids: set[str]) -> str | None:
    for metric_id in slide.metric_ids:
        for table_id in table_ids:
            if metric_id in table_id:
                return table_id
    return next(iter(table_ids), None) if slide.kind == "content" and table_ids else None


def _claim_text(slide: SlidePlan) -> str:
    parts = [slide.key_message, *slide.content_elements[:3]]
    return "\n".join(part for part in parts if part).strip() or slide.communication_goal


def _source_refs(task: CalculationTask) -> list[str]:
    return [
        f"{binding.workbook_selector}/{binding.sheet_selector}/{binding.column_selector}"
        for binding in task.input_bindings
    ]


def _chart_type(visualization: str) -> str:
    text = visualization.lower()
    if any(token in text for token in ("line", "trend", "time", "時間", "趨勢", "走勢")):
        return "line"
    if any(token in text for token in ("pie", "donut", "圓餅", "甜甜圈", "占比", "佔比")):
        return "pie"
    if any(token in text for token in ("column", "bar", "比較", "排行", "排名")):
        return "column"
    return "bar"


def _display_format(unit: str, value: float) -> str:
    if unit in {"%", "％", "percent"}:
        return "percent"
    if unit in {"元", "萬", "億", "$", "NTD", "USD"}:
        return "currency"
    if float(value).is_integer():
        return "integer"
    return "number"


def _cell_value(value: Any) -> str | float | int:
    if isinstance(value, (str, int, float)):
        return value
    if value is None:
        return ""
    return str(value)


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.replace(",", "").replace("%", "").replace("％", "").strip()
        if not normalized:
            return None
        try:
            return float(normalized)
        except ValueError:
            return None
    return None
