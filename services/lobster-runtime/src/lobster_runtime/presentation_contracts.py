"""Contracts for agent-led presentation generation and artifact validation."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    def __getitem__(self, key: str):
        if key == "id":
            for id_key in ("metric_id", "chart_id", "claim_id", "table_id"):
                if hasattr(self, id_key):
                    return getattr(self, id_key)
        if key == "name" and hasattr(self, "label"):
            return getattr(self, "label")
        return getattr(self, key)

    def get(self, key: str, default=None):
        try:
            return self[key]
        except AttributeError:
            return default


class Box(StrictModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class EvidenceMetric(StrictModel):
    metric_id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    value: float
    unit: str = ""
    display_format: Literal["number", "percent", "currency", "integer"] = "number"
    source_refs: list[str] = Field(default_factory=list)
    calculation: str = ""


class ChartSeries(StrictModel):
    name: str = Field(min_length=1)
    values: list[float] = Field(min_length=1)


class ChartData(StrictModel):
    chart_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    chart_type: Literal["bar", "column", "line", "pie"] = "bar"
    categories: list[str] = Field(min_length=1)
    series: list[ChartSeries] = Field(min_length=1)
    metric_refs: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_lengths(self) -> "ChartData":
        for series in self.series:
            if len(series.values) != len(self.categories):
                raise ValueError("chart series values must match category count")
        return self


class ClaimRecord(StrictModel):
    claim_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    metric_refs: list[str] = Field(default_factory=list)
    chart_refs: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)


class TableData(StrictModel):
    table_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    headers: list[str] = Field(min_length=1)
    rows: list[list[str | float | int]] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)


class EvidencePacketV2(StrictModel):
    packet_id: str = Field(min_length=1)
    metrics: list[EvidenceMetric] = Field(default_factory=list)
    charts: list[ChartData] = Field(default_factory=list)
    claims: list[ClaimRecord] = Field(default_factory=list)
    tables: list[TableData] = Field(default_factory=list)


class TemplateProfile(StrictModel):
    template_path: str | None = None
    source: Literal["uploaded", "default"] = "default"
    slide_width: float = 13.333
    slide_height: float = 7.5
    layouts: list[str] = Field(default_factory=list)
    theme_fonts: list[str] = Field(default_factory=list)
    theme_colors: list[str] = Field(default_factory=list)
    fixed_regions: list[Box] = Field(default_factory=list)
    sample_slides: list[dict[str, Any]] = Field(default_factory=list)


class BlueprintElement(StrictModel):
    element_id: str = Field(min_length=1)
    type: Literal["title", "text", "metricCard", "chart", "claim", "table"]
    box: Box
    text: str | None = None
    metric_ref: str | None = None
    chart_ref: str | None = None
    claim_ref: str | None = None
    table_ref: str | None = None


class BlueprintSlide(StrictModel):
    slide_id: str = Field(min_length=1)
    role: Literal["cover", "content", "section", "appendix", "back-cover"] = "content"
    intent: str = Field(min_length=1)
    layout_strategy: str = Field(min_length=1)
    elements: list[BlueprintElement] = Field(min_length=1)


class PresentationBlueprint(StrictModel):
    blueprint_version: Literal["presentation-blueprint-v1"] = "presentation-blueprint-v1"
    title: str = Field(min_length=1)
    slides: list[BlueprintSlide] = Field(min_length=1)


class PythonRendererProgram(StrictModel):
    program_version: Literal["python-renderer-program-v1"] = "python-renderer-program-v1"
    entrypoint: Literal["render"] = "render"
    source_code: str = Field(min_length=1)
    rationale: str = Field(min_length=1)


class RenderArtifactManifest(StrictModel):
    pptx_path: str
    xlsx_path: str
    slide_count: int = Field(ge=1)
    chart_count: int = Field(ge=0)
    table_count: int = Field(ge=0)
    evidence_refs_used: list[str] = Field(default_factory=list)


class ArtifactFinding(StrictModel):
    severity: Literal["blocking", "warning", "info"]
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    origin_stage: Literal["data", "analysis", "design", "render-code", "artifact-validation"]


class ArtifactValidationReport(StrictModel):
    status: Literal["final", "draft", "failed_validation"]
    findings: list[ArtifactFinding] = Field(default_factory=list)
    checked_slide_count: int = Field(ge=0)
    checked_chart_count: int = Field(ge=0)
    checked_table_count: int = Field(ge=0)
