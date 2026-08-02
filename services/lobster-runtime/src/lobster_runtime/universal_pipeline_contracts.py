"""Contracts for the six-stage universal data-to-presentation pipeline."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .presentation_contracts import PresentationBlueprint


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ColumnProfile(StrictModel):
    name: str
    inferred_type: Literal["number", "date", "text", "mixed", "empty"]
    non_empty_count: int = Field(ge=0)
    examples: list[str] = Field(default_factory=list)
    numeric_sum: float | None = None


class SheetProfile(StrictModel):
    file_name: str
    sheet_name: str
    header_row: int
    row_count: int = Field(ge=0)
    columns: list[ColumnProfile]
    quality_findings: list[str] = Field(default_factory=list)


class DataIntelligenceReport(StrictModel):
    stage: Literal["data-intelligence"] = "data-intelligence"
    status: Literal["passed", "passed_with_warnings", "blocked"]
    data_structure_summary: str
    semantic_notes: list[str]
    relationship_hypotheses: list[str]
    quality_findings: list[str]
    usable_data_notes: list[str]


class CandidateAnalysis(StrictModel):
    analysis_id: str
    question: str
    method: str
    required_columns: list[str]
    feasible: bool
    rationale: str
    recommended_visual: str


class AnalysisFeasibilityPlan(StrictModel):
    stage: Literal["analysis-feasibility"] = "analysis-feasibility"
    status: Literal["passed", "passed_with_warnings", "blocked"]
    accepted_analyses: list[CandidateAnalysis]
    rejected_analyses: list[CandidateAnalysis]
    known_limits: list[str]
    questions_for_user: list[str]


class VerifiedAnalysisNarrative(StrictModel):
    stage: Literal["verified-analysis"] = "verified-analysis"
    status: Literal["passed", "passed_with_warnings", "blocked"]
    insight_summaries: list[str]
    caveats: list[str]
    evidence_usage_notes: list[str]


class BlueprintStageOutput(StrictModel):
    stage: Literal["presentation-design"] = "presentation-design"
    status: Literal["passed", "passed_with_warnings", "blocked"]
    blueprint: PresentationBlueprint
    design_notes: list[str]


class FullPipelineManifest(StrictModel):
    status: Literal["final", "draft", "failed_validation"]
    data_report: DataIntelligenceReport
    feasibility_plan: AnalysisFeasibilityPlan
    verified_narrative: VerifiedAnalysisNarrative
    blueprint_output: BlueprintStageOutput
    pptx_path: str
    xlsx_path: str
    validation_report_path: str
