"""Flexible, strict contracts for AI-generated prompt and presentation plans."""

from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


RequirementOrigin = Literal["explicit", "inferred", "recommended"]
SlideKind = Literal["cover", "content", "section", "appendix", "back-cover"]
EditableScalar: TypeAlias = str | int | float | bool | None
EditableFields: TypeAlias = dict[str, EditableScalar | list[EditableScalar]]


class MetricRequirement(StrictModel):
    metric_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    definition_needed: str
    calculation_required: bool = False
    origin: RequirementOrigin
    required: bool = True
    custom_fields: EditableFields = Field(default_factory=dict)


class ChartRequirement(StrictModel):
    chart_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    visualization: str = Field(min_length=1, description="AI-selected visual form; not restricted to a fixed enum")
    purpose: str = Field(min_length=1)
    data_requirements: list[str]
    formula_ids: list[str]
    calculation_task_ids: list[str]
    origin: RequirementOrigin
    rationale: str
    required: bool = True
    custom_fields: EditableFields = Field(default_factory=dict)


class InsightRequirement(StrictModel):
    insight_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    evidence_needed: list[str]
    origin: RequirementOrigin
    required: bool = True
    custom_fields: EditableFields = Field(default_factory=dict)


class FlexibleRequirement(StrictModel):
    requirement_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    description: str = Field(min_length=1)
    origin: RequirementOrigin
    acceptance_criteria: list[str]
    custom_fields: EditableFields = Field(default_factory=dict)


FormulaSourceType = Literal["user-provided", "workbook-derived", "model-knowledge", "web-research"]
FormulaVerificationState = Literal["unverified", "verified", "rejected"]
FormulaStatus = Literal["verified", "needs-research", "needs-user-confirmation", "unsupported"]


class FormulaVariable(StrictModel):
    symbol: str = Field(min_length=1)
    definition: str = Field(min_length=1)
    expected_unit: str


class FormulaSourceCandidate(StrictModel):
    source_type: FormulaSourceType
    title: str = Field(min_length=1)
    locator: str = Field(min_length=1, description="URL for web research or a human-readable source locator")
    rationale: str = Field(min_length=1)
    verification_state: FormulaVerificationState


class FormulaDefinition(StrictModel):
    formula_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    expression: str = Field(min_length=1)
    variables: list[FormulaVariable] = Field(min_length=1)
    output_unit: str
    applicability_conditions: list[str]
    assumptions: list[str]
    missing_data_policy: str = Field(min_length=1)
    zero_division_policy: str = Field(min_length=1)
    source_candidates: list[FormulaSourceCandidate]
    status: FormulaStatus
    required: bool = True
    custom_fields: EditableFields = Field(default_factory=dict)


class FormulaPlan(StrictModel):
    plan_version: Literal["formula-plan-v1"] = "formula-plan-v1"
    research_strategy: Literal["none", "model-knowledge-only", "controlled-web-research", "mixed"]
    formulas: list[FormulaDefinition]
    unresolved_questions: list[str]
    custom_fields: EditableFields = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_formula_ids(self) -> "FormulaPlan":
        identifiers = [formula.formula_id for formula in self.formulas]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("formula identifiers must be unique")
        return self


class CalculationInputBinding(StrictModel):
    variable: str = Field(min_length=1)
    workbook_upload_id: str = Field(min_length=1)
    workbook_selector: str = Field(min_length=1)
    sheet_selector: str = Field(min_length=1)
    column_selector: str = Field(min_length=1)
    cell_range_hint: str
    aggregation: str = Field(min_length=1)
    required: bool = True


class CalculationTask(StrictModel):
    task_id: str = Field(min_length=1)
    output_metric_id: str = Field(min_length=1)
    formula_id: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    input_bindings: list[CalculationInputBinding] = Field(min_length=1)
    output_fields: list[str] = Field(min_length=1)
    code_generation_instructions: list[str] = Field(min_length=1)
    validation_checks: list[str] = Field(min_length=1)
    provenance_requirements: list[str] = Field(min_length=1)
    custom_fields: EditableFields = Field(default_factory=dict)


class GeneratedCodePolicy(StrictModel):
    language: Literal["python"] = "python"
    allowed_libraries: list[Literal["python-standard-library", "openpyxl"]] = Field(min_length=1)
    network_access: Literal[False] = False
    read_only_inputs: Literal[True] = True
    forbidden_operations: list[str] = Field(min_length=1)


class CalculationPlan(StrictModel):
    plan_version: Literal["calculation-plan-v1"] = "calculation-plan-v1"
    generated_code_policy: GeneratedCodePolicy
    tasks: list[CalculationTask]
    execution_order: list[str]
    custom_fields: EditableFields = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_task_order(self) -> "CalculationPlan":
        task_ids = [task.task_id for task in self.tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("calculation task identifiers must be unique")
        if self.execution_order != task_ids:
            raise ValueError("calculation execution_order must list every task exactly once in task order")
        return self


class TemplateAnalysisPlan(StrictModel):
    template_required: bool
    classification_rules: list[str] = Field(min_length=1)
    required_slide_roles: list[Literal["cover", "content", "section", "appendix", "back-cover"]] = Field(min_length=1)
    inspect_master_layouts: Literal[True] = True
    inspect_placeholders: Literal[True] = True
    inspect_theme_and_dimensions: Literal[True] = True
    preserve_unmodified_template_objects: Literal[True] = True


class PythonPptGenerationPlan(StrictModel):
    language: Literal["python"] = "python"
    primary_library: Literal["python-pptx"] = "python-pptx"
    generation_steps: list[str] = Field(min_length=1)
    editable_object_requirements: list[str] = Field(min_length=1)
    fidelity_checks: list[str] = Field(min_length=1)


class PreviewEditingPlan(StrictModel):
    manual_editable_fields: list[str] = Field(min_length=1)
    natural_language_editing: Literal[True] = True
    revision_behavior: list[str] = Field(min_length=1)


class ProvenanceDisplayPlan(StrictModel):
    required_fields: list[str] = Field(min_length=1)
    show_per_chart: Literal[True] = True
    show_only_actual_data: Literal[True] = True


class PresentationGenerationPlan(StrictModel):
    plan_version: Literal["presentation-generation-plan-v1"] = "presentation-generation-plan-v1"
    template_analysis: TemplateAnalysisPlan
    python_generation: PythonPptGenerationPlan
    layout_consistency_rules: list[str] = Field(min_length=1)
    preview_editing: PreviewEditingPlan
    provenance_display: ProvenanceDisplayPlan
    final_export_requirements: list[str] = Field(min_length=1)
    custom_fields: EditableFields = Field(default_factory=dict)


StageClass = Literal["understand", "acquire", "analyze", "compose", "render-verify"]
ToolCategory = Literal["contract", "data-read", "research", "calculation", "analysis", "deck-planning", "rendering", "inspection"]
EXPECTED_STAGE_ORDER: tuple[StageClass, ...] = ("understand", "acquire", "analyze", "compose", "render-verify")
STAGE_TOOL_POLICY: dict[StageClass, frozenset[ToolCategory]] = {
    "understand": frozenset({"contract"}),
    "acquire": frozenset({"data-read", "research"}),
    "analyze": frozenset({"calculation", "analysis"}),
    "compose": frozenset({"deck-planning"}),
    "render-verify": frozenset({"rendering", "inspection"}),
}


class ExecutionStagePlan(StrictModel):
    stage_id: str = Field(min_length=1)
    stage_class: StageClass
    objective: str = Field(min_length=1)
    planned_activities: list[str]
    required_inputs: list[str]
    allowed_tool_categories: list[ToolCategory]
    required_outputs: list[str]
    validation_checks: list[str] = Field(min_length=1)
    completion_criteria: list[str] = Field(min_length=1)
    requires_user_approval: bool


class FiveStageExecutionPlan(StrictModel):
    stages: list[ExecutionStagePlan] = Field(min_length=5, max_length=5)

    @model_validator(mode="after")
    def validate_governance_order(self) -> "FiveStageExecutionPlan":
        if tuple(stage.stage_class for stage in self.stages) != EXPECTED_STAGE_ORDER:
            raise ValueError("execution stages must follow the fixed five-stage governance order")
        if len({stage.stage_id for stage in self.stages}) != len(self.stages):
            raise ValueError("execution stage identifiers must be unique")
        for stage in self.stages:
            disallowed = set(stage.allowed_tool_categories) - STAGE_TOOL_POLICY[stage.stage_class]
            if disallowed:
                raise ValueError(f"stage {stage.stage_class} uses tool categories outside its governance policy")
        return self


class PromptContract(StrictModel):
    contract_version: Literal["prompt-contract-v3"] = "prompt-contract-v3"
    user_intent: str = Field(min_length=1)
    presentation_goal: str = Field(min_length=1)
    target_audience: str
    language: str = Field(min_length=1)
    recommended_page_count: int = Field(ge=3, le=60)
    page_count_origin: RequirementOrigin
    page_count_rationale: str
    tone_and_style: list[str]
    visual_direction: list[str]
    metrics: list[MetricRequirement]
    charts: list[ChartRequirement]
    insights: list[InsightRequirement]
    data_requirements: list[str]
    research_requirements: list[str]
    formula_requirements: list[str]
    content_constraints: list[str]
    output_requirements: list[str]
    custom_requirements: list[FlexibleRequirement]
    assumptions: list[str]
    ambiguities: list[str]
    custom_fields: EditableFields = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_requirement_ids(self) -> "PromptContract":
        identifiers = [item.metric_id for item in self.metrics]
        identifiers += [item.chart_id for item in self.charts]
        identifiers += [item.insight_id for item in self.insights]
        identifiers += [item.requirement_id for item in self.custom_requirements]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("requirement identifiers must be unique")
        return self


class SlidePlan(StrictModel):
    page_number: int = Field(ge=1)
    kind: SlideKind
    title: str = Field(min_length=1)
    communication_goal: str = Field(min_length=1)
    key_message: str = Field(min_length=1)
    content_elements: list[str]
    metric_ids: list[str]
    formula_ids: list[str]
    chart_ids: list[str]
    insight_ids: list[str]
    custom_requirement_ids: list[str]
    evidence_requirements: list[str]
    layout_guidance: str
    speaker_notes_guidance: str
    editable: bool = True
    custom_fields: EditableFields = Field(default_factory=dict)


class DeckPlan(StrictModel):
    plan_version: Literal["deck-plan-v3"] = "deck-plan-v3"
    title: str = Field(min_length=1)
    subtitle: str
    total_pages: int = Field(ge=3, le=60)
    narrative_strategy: str = Field(min_length=1)
    narrative_arc: list[str]
    slides: list[SlidePlan] = Field(min_length=3, max_length=60)
    unresolved_questions: list[str]
    planning_notes: list[str]
    custom_fields: EditableFields = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_slide_sequence(self) -> "DeckPlan":
        if len(self.slides) != self.total_pages:
            raise ValueError("slides must contain exactly total_pages entries")
        if [slide.page_number for slide in self.slides] != list(range(1, self.total_pages + 1)):
            raise ValueError("slide page numbers must be contiguous and one-based")
        if self.slides[0].kind != "cover" or self.slides[-1].kind != "back-cover":
            raise ValueError("a deck must start with a cover and end with a back-cover")
        return self


class AIPlanningOutput(StrictModel):
    output_version: Literal["ai-planning-output-v3"] = "ai-planning-output-v3"
    prompt_contract: PromptContract
    formula_plan: FormulaPlan
    calculation_plan: CalculationPlan
    presentation_generation_plan: PresentationGenerationPlan
    execution_plan: FiveStageExecutionPlan
    deck_plan: DeckPlan
    custom_fields: EditableFields = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_cross_contract_invariants(self) -> "AIPlanningOutput":
        if self.deck_plan.total_pages != self.prompt_contract.recommended_page_count:
            raise ValueError("deck page count must match the prompt contract recommendation")
        metric_ids = {metric.metric_id for metric in self.prompt_contract.metrics}
        formula_ids = {formula.formula_id for formula in self.formula_plan.formulas}
        task_ids = {task.task_id for task in self.calculation_plan.tasks}
        calculated_metric_ids = {task.output_metric_id for task in self.calculation_plan.tasks}
        required_calculations = {
            metric.metric_id for metric in self.prompt_contract.metrics if metric.calculation_required
        }
        if required_calculations - calculated_metric_ids:
            raise ValueError("every calculation-required metric must have a calculation task")
        for task in self.calculation_plan.tasks:
            if task.output_metric_id not in metric_ids:
                raise ValueError("calculation task references an unknown metric")
            if task.formula_id not in formula_ids:
                raise ValueError("calculation task references an unknown formula")
            variables = {variable.symbol for variable in next(
                formula for formula in self.formula_plan.formulas if formula.formula_id == task.formula_id
            ).variables}
            bindings = {binding.variable for binding in task.input_bindings}
            if variables != bindings:
                raise ValueError("calculation input bindings must match the formula variables")
        if set(self.calculation_plan.execution_order) != task_ids:
            raise ValueError("calculation execution order references unknown tasks")
        chart_formula_ids = {item for chart in self.prompt_contract.charts for item in chart.formula_ids}
        chart_task_ids = {item for chart in self.prompt_contract.charts for item in chart.calculation_task_ids}
        slide_formula_ids = {item for slide in self.deck_plan.slides for item in slide.formula_ids}
        if (chart_formula_ids | slide_formula_ids) - formula_ids:
            raise ValueError("chart or slide references an unknown formula")
        if chart_task_ids - task_ids:
            raise ValueError("chart references an unknown calculation task")
        return self


class RequirementsPlanningStageOutput(StrictModel):
    """Stage 1 output: prompt interpretation and presentation requirements only."""

    prompt_contract: PromptContract


class FormulaPlanningStageOutput(StrictModel):
    """Stage 2 output: compact formula definitions only."""

    formula_plan: FormulaPlan


class RequirementsAndFormulaStageOutput(StrictModel):
    """Merged stage 1+2 output: prompt interpretation and formula definitions in one LLM call."""

    prompt_contract: PromptContract
    formula_plan: FormulaPlan


class ChartCalculationLink(StrictModel):
    chart_id: str = Field(min_length=1)
    formula_ids: list[str]
    calculation_task_ids: list[str]


class CalculationPlanningStageOutput(StrictModel):
    """Stage 3 output: deterministic Excel calculation work and chart links."""

    calculation_plan: CalculationPlan
    chart_calculation_links: list[ChartCalculationLink]

    @model_validator(mode="after")
    def validate_unique_chart_links(self) -> "CalculationPlanningStageOutput":
        identifiers = [link.chart_id for link in self.chart_calculation_links]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("chart calculation link identifiers must be unique")
        return self


class CompositionPlanningStageOutput(StrictModel):
    """Stage 3 output: PPT generation policy, governed execution, and slides."""

    presentation_generation_plan: PresentationGenerationPlan
    execution_plan: FiveStageExecutionPlan
    deck_plan: DeckPlan


class PromptCoverageItem(StrictModel):
    requirement: str = Field(min_length=1)
    status: Literal["covered", "partial", "missing"]
    plan_references: list[str]
    rationale: str = Field(min_length=1)


class PromptAlignmentValidation(StrictModel):
    score: int = Field(ge=0, le=100)
    approved: bool
    coverage_items: list[PromptCoverageItem] = Field(min_length=1, max_length=16)
    missing_explicit_requirements: list[str]
    summary: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_approval(self) -> "PromptAlignmentValidation":
        if self.approved and self.missing_explicit_requirements:
            raise ValueError("an approved prompt alignment cannot have missing explicit requirements")
        return self


class ValidationReport(StrictModel):
    valid: Literal[True] = True
    checked_slide_count: int
    checked_references: int
    findings: list[str]
    prompt_alignment_score: int | None = Field(default=None, ge=0, le=100)
    prompt_alignment_findings: list[str] = Field(default_factory=list)


class ToolReceipt(StrictModel):
    tool_name: str
    tool_version: str
    status: Literal["succeeded"]
    input_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    output_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    started_at: str
    completed_at: str
    safe_summary: str


class AgentPlan(StrictModel):
    execution_id: str
    adapter_version: Literal["lobster-runtime-adapter-v3"] = "lobster-runtime-adapter-v3"
    sdk_name: Literal["strands-agents"] = "strands-agents"
    sdk_version: str
    planning_output: AIPlanningOutput
    validation_report: ValidationReport
    tool_receipts: list[ToolReceipt]


class StageManifest(StrictModel):
    execution_id: str
    stage_id: str
    context_version: int = Field(ge=0)
    attempt: int = Field(ge=1)
    status: Literal["succeeded"]
    output_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    tool_receipts: list[ToolReceipt]


class CancellationReceipt(StrictModel):
    execution_id: str
    stage_id: str
    status: Literal["cancelled"] = "cancelled"
    cancelled_at: str
