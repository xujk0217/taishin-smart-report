"""Pinned Strands implementation of the stable LobsterRuntimeAdapter boundary."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
from datetime import datetime, timezone
from typing import Any, Protocol, TypeVar
from uuid import uuid4

from pydantic import BaseModel
from strands import Agent
from strands.models import Model
from strands.types.exceptions import MaxTokensReachedException

from .contracts import (
    AIPlanningOutput,
    AgentPlan,
    CalculationPlanningStageOutput,
    CancellationReceipt,
    DeckPlan,
    FiveStageExecutionPlan,
    FormulaPlan,
    FormulaPlanningStageOutput,
    PromptAlignmentValidation,
    PromptContract,
    PresentationGenerationPlan,
    RequirementsAndFormulaStageOutput,
    RequirementsPlanningStageOutput,
    StageManifest,
    ToolReceipt,
    ValidationReport,
)
from .planner import validate_deck_plan_tool, validate_planning_output


ALLOWED_TOOLS = frozenset({"validate-deck-plan"})
STAGE_TOKEN_BUDGETS = {
    # More generous first-pass budgets to accommodate user requests with many
    # metrics/formulas without wasting a full LLM round on truncation retries.
    "requirements_and_formula": (32_000, 48_000),
    "requirements": (32_000, 48_000),
    "formula": (32_000, 48_000),
    "calculation": (32_000, 48_000),
    "composition": (32_000, 48_000),
}


class StageOutputTooLargeError(RuntimeError):
    """A planning stage exhausted every model-safe output budget."""

    def __init__(self, stage: str, attempts: int, token_budget: int) -> None:
        self.stage = stage
        self.attempts = attempts
        self.token_budget = token_budget
        super().__init__(
            f"{stage} stage exceeded its output limit after {attempts} attempts "
            f"(last token budget: {token_budget})"
        )


PLANNER_SYSTEM_PROMPT = """
You are the Lobster presentation planning agent. Interpret the user's entire prompt semantically.
Do not use a fixed industry template, keyword routing table, or predefined audience/style/chart mapping.
Decide all relevant requirements from context, including requirements not anticipated by the caller.

Produce the requested AIPlanningOutput schema. Separate explicit user requirements from your inferences
and recommendations. Consider, when relevant: audience, goal, language, metrics, evidence, insights,
data acquisition, research, formulas, visual forms, page count, narrative, branding, output constraints,
and any other custom requirement. These are considerations, not mandatory content or fixed choices.
Never fabricate findings, numbers, sources, or completed research.

For every metric that requires calculation, define a machine-readable formula and a deterministic Python
calculation task. Bind every formula variable to the actual workbook, sheet, column, and optional cell range
that a generated program must read. The future execution agent writes and runs the Python program; you must
not perform arithmetic mentally or invent computed values in this planning step. Formula sources may come
from the user, workbook evidence, model knowledge, or controlled web research. Mark model knowledge and any
source not actually retrieved as unverified, and request research or user confirmation when needed.

Also produce a presentation_generation_plan. It must describe how a later Python agent will inspect the
uploaded PPTX template, classify cover/content/section/appendix/back-cover layouts, preserve theme and
editable objects, generate the exact approved page count and content, enforce consistent chart-to-text
balance, provide browser preview edits (manual and natural language), and export the final PPTX. Every chart
preview must disclose actual workbook, sheet, column/range, formula, calculation steps, result, and unit.
Never introduce synthetic industry data or a fallback deck.

All normal fields and custom_fields are user-editable during plan review. Natural-language revisions replace
the complete validated plan; manual edits submit the complete validated JSON. Unknown top-level fields remain
forbidden, so novel requirements belong in the declared custom_fields or custom_requirements extension points.

OUTPUT BUDGET: This is a comprehensive planning pass. Plan every metric, formula, chart, and insight
that the user explicitly requests. Do not artificially limit the count — if the user asks for 10 metrics,
plan all 10. But keep each individual item's description concise: one short sentence per text field,
one line per list item. Keep custom_fields empty unless they carry a truly novel requirement.
The slide plan must still contain exactly the approved page count. Prefer stable identifiers and
references over copying long prose. Completeness means every required schema field is present and every
user-requested item is accounted for.

Use the fixed five-stage governance envelope only to control timing:
1. understand: interpret the prompt and establish the contract;
2. acquire: identify and obtain approved source data or controlled research;
3. analyze: calculate and derive evidence-backed insights;
4. compose: design narrative, charts, and page-by-page content;
5. render-verify: generate editable artifacts and inspect exact references and integrity.
Choose the work inside each stage dynamically. Every stage must define validation and completion criteria.
""".strip()

REQUIREMENTS_STAGE_PROMPT = """
You are stage 1 of a presentation planning pipeline. Interpret the user's prompt and actual workbook
profiles, then return RequirementsPlanningStageOutput only. Define the audience, goal, page count,
metrics, chart requirements, insights, constraints, and editable custom requirements. Never fabricate
workbooks, sheets, columns, findings, or calculated values. Leave every chart's formula_ids and
calculation_task_ids empty; stage 2 owns those identifiers and the program will attach them. Keep the output compact: normally no
more than 4 metrics, 4 charts, 4 insights, and 2 custom requirements, with short text fields. Mark inferred or
recommended insights, charts, visual choices, and layout preferences as required=false unless explicitly asked
for or essential to a requested calculation; they are editable suggestions, not release blockers. Target under
550 output tokens. When revising, apply the user's instruction to the supplied previous stage while preserving
unaffected requirements.
""".strip()

FORMULA_STAGE_PROMPT = """
You are stage 2 of a presentation planning pipeline. Using the approved PromptContract and actual workbook
profiles, return FormulaPlanningStageOutput only. Define only the formula plan needed for the requested
metrics and charts. Do not calculate values or create Excel tasks in this stage. Formula sources may be user
provided, workbook-derived, model knowledge, or controlled web research; anything not retrieved must remain
unverified. Keep at most 3 formulas unless explicitly required, and keep explanations short. Target under 500
output tokens. When revising, apply the user's instruction to the supplied previous formula plan while preserving
unaffected work.
""".strip()

REQUIREMENTS_AND_FORMULA_STAGE_PROMPT = """
You are the merged stage 1+2 of a presentation planning pipeline. Interpret the user's prompt and actual
workbook profiles, then return RequirementsAndFormulaStageOutput only — containing both the PromptContract
(stage 1) and the FormulaPlan (stage 2) in a single response.

First define the audience, goal, page count, metrics, chart requirements, insights, constraints, and
editable custom requirements. Never fabricate workbooks, sheets, columns, findings, or calculated values.
Leave every chart's formula_ids and calculation_task_ids empty; stage 3 owns those identifiers.

Then, using the PromptContract you just defined and the actual workbook profiles, define the formula plan
needed for the requested metrics and charts. Do not calculate values or create Excel tasks. Formula
sources may be user provided, workbook-derived, model knowledge, or controlled web research; anything not
retrieved must remain unverified.

IMPORTANT: Plan ALL metrics and formulas that the user explicitly requests. Do not artificially limit the
count. If the user asks for 10 metrics, plan all 10. Only mark items as required=true when the user
explicitly asks for them or they are essential to a requested calculation. Mark inferred/recommended
insights and visual choices as required=false — they are editable suggestions, not release blockers.

Keep individual descriptions concise: one short sentence per text field, one line per list item.
Target under 2000 output tokens when the user requests many metrics. When revising, apply the user's
instruction to the supplied previous stage while preserving unaffected requirements and formulas.
""".strip()

CALCULATION_STAGE_PROMPT = """
You are stage 3 of a presentation planning pipeline. Using the approved PromptContract, formula plan, and
actual workbook profiles, return CalculationPlanningStageOutput only. Create deterministic Python calculation
tasks and chart_calculation_links. Do not define, rename, or omit formula variables: each task must use an
existing formula_id and bind every formula variable exactly once with the same symbol. Bind each variable to an
actual upload id, exact file name, sheet, and visible column from the workbook profiles. Do not calculate values
yourself. Give every calculation_required metric a task, and return one chart link for every chart (empty arrays
are allowed only when that chart needs no calculation). Return exactly one task for each
calculation_required metric, even when multiple tasks reuse one formula. Do not impose an artificial task-count
limit: the number of tasks must match the supplied calculation_required metrics. Use only Python standard library
and openpyxl, read-only inputs, no network. Keep lists and explanations short. Target under 950 output tokens.
On a correction request, use previous_calculation_stage_output as the baseline. Preserve every valid task and
chart link; change only the named invalid task or link. Copy the formula variable symbols character-for-character:
aliases, display labels, additional bindings, and duplicate bindings are invalid. When revising, apply the user's
instruction to the supplied previous calculation plan while preserving unaffected work.
""".strip()

COMPOSITION_STAGE_PROMPT = """
You are the deck-composition stage of a presentation planning pipeline. Using the approved requirement,
formula, and calculation stages, return DeckPlan only. Produce exactly the approved number of slides, starting
with a cover and ending with a back cover, and reference only identifiers that exist in the supplied stages.
Assign every required metric, chart, insight, custom requirement, and required formula to at least one slide.
Never add synthetic data.

SPEED MODE: Keep each slide ultra-compact. One short phrase per text field. Skip layout_guidance and
speaker_notes_guidance unless critical. Use at most 1-2 identifiers per reference list. The user will
manually refine details during plan review. Target under 1200 output tokens total. When revising,
apply the user's instruction to the supplied previous deck plan while preserving unaffected slides.
""".strip()

PROMPT_ALIGNMENT_STAGE_PROMPT = """
You are an independent prompt-to-plan validator. Compare the original user prompt with the compact, verified plan
summary. Return PromptAlignmentValidation only; do not modify the plan and do not invent requirements.
List every explicit user requirement that materially affects the requested deck, calculations, data provenance,
template handling, output, or editing. Mark it covered only when the plan has a concrete relevant field or ID.
Use partial or missing when coverage is vague. approved may be true only when every explicit requirement is
covered and missing_explicit_requirements is empty. Score semantic coverage from 0 to 100 and keep this compact,
under 900 output tokens.
""".strip()

StageOutput = TypeVar("StageOutput", bound=BaseModel)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class LobsterRuntimeAdapter(Protocol):
    def plan(
        self,
        prompt: str,
        *,
        workbook_context: list[dict[str, Any]] | None = None,
        previous_planning_output: AIPlanningOutput | dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> AgentPlan: ...
    def execute(self, planning_output: AIPlanningOutput, *, attempt: int = 1) -> StageManifest: ...
    def resume(self, context_version: int, attempt: int) -> StageManifest: ...
    def cancel(self, execution_id: str, stage_id: str) -> CancellationReceipt: ...


class StrandsLobsterRuntimeAdapter:
    """AI-driven planner with registry-only deterministic validation.

    A model must be injected explicitly. This class never selects a provider, reads environment
    configuration, or falls back to heuristic planning.

    When ``complex_model`` is provided, stages that require reasoning depth
    (requirements_and_formula, calculation) use it; all other stages use ``model``.
    """

    _COMPLEX_STAGES = frozenset({"requirements_and_formula", "calculation"})

    def __init__(self, model: Model, complex_model: Model | None = None) -> None:
        self._model = model
        self._complex_model = complex_model or model
        self._agent = Agent(
            model=model,
            tools=[validate_deck_plan_tool],
            system_prompt=PLANNER_SYSTEM_PROMPT,
            callback_handler=None,
            load_tools_from_directory=False,
            record_direct_tool_call=False,
            name="Lobster AI Deck Planner",
        )
        if frozenset(self._agent.tool_names) != ALLOWED_TOOLS:
            raise RuntimeError("Strands tool registry does not match the approved allowlist")
        self._manifests: dict[tuple[int, int], StageManifest] = {}
        self._active_job_id: str | None = None

    def _model_for_stage(self, stage_name: str) -> Model:
        return self._complex_model if stage_name in self._COMPLEX_STAGES else self._model

    @property
    def registered_tools(self) -> frozenset[str]:
        return frozenset(self._agent.tool_names)

    def plan(
        self,
        prompt: str,
        *,
        workbook_context: list[dict[str, Any]] | None = None,
        previous_planning_output: AIPlanningOutput | dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> AgentPlan:
        # A worker processes a single job. Correlating every stage event lets the
        # owner-facing API query only that job's CloudWatch records.
        self._active_job_id = job_id
        normalized = " ".join(prompt.split())
        if not normalized:
            raise ValueError("prompt must not be blank")

        previous = (
            AIPlanningOutput.model_validate(previous_planning_output)
            if previous_planning_output is not None
            else None
        )
        workbook_profiles = workbook_context or []
        lightweight_profiles = self._lightweight_workbook_profiles(workbook_profiles)

        # --- Merged stage 1+2: requirements + formula in a single LLM call ---
        merged_context: dict[str, Any] = {
            "user_prompt": normalized,
            "workbook_profiles": lightweight_profiles,
        }
        if previous is not None:
            merged_context["previous_prompt_contract"] = previous.prompt_contract.model_dump(mode="json")
            merged_context["previous_formula_plan"] = previous.formula_plan.model_dump(mode="json")
        merged = self._run_stage(
            "requirements_and_formula",
            RequirementsAndFormulaStageOutput,
            REQUIREMENTS_AND_FORMULA_STAGE_PROMPT,
            merged_context,
        )
        requirements_contract = self._without_calculation_links(merged.prompt_contract)
        formula = FormulaPlanningStageOutput(formula_plan=merged.formula_plan)

        calculation_context: dict[str, Any] = {
            "user_prompt": normalized,
            "workbook_profiles": lightweight_profiles,
            "prompt_contract": requirements_contract.model_dump(mode="json"),
            "formula_plan": formula.formula_plan.model_dump(mode="json"),
        }
        if previous is not None:
            calculation_context["previous_calculation_plan"] = previous.calculation_plan.model_dump(mode="json")
        calculation = self._run_calculation_stage(
            requirements_contract,
            formula.formula_plan,
            calculation_context,
            lightweight_profiles,
        )
        prompt_contract = self._attach_calculation_links(requirements_contract, calculation)

        composition_context: dict[str, Any] = {
            "user_prompt": normalized,
            "prompt_contract": prompt_contract.model_dump(mode="json"),
            "formula_plan": formula.formula_plan.model_dump(mode="json"),
            "calculation_plan": calculation.calculation_plan.model_dump(mode="json"),
        }
        if previous is not None:
            composition_context["previous_deck_plan"] = previous.deck_plan.model_dump(mode="json")
        deck_plan, presentation_generation_plan, execution_plan, prompt_alignment = self._run_composition_stage(
            normalized,
            prompt_contract,
            formula,
            calculation,
            composition_context,
        )
        planning_output = AIPlanningOutput(
            prompt_contract=prompt_contract,
            formula_plan=formula.formula_plan,
            calculation_plan=calculation.calculation_plan,
            presentation_generation_plan=presentation_generation_plan,
            execution_plan=execution_plan,
            deck_plan=deck_plan,
        )

        started = _utc_now()
        tool_result = self._agent.tool.validate_deck_plan(
            record_direct_tool_call=False,
            planning_output=planning_output.model_dump(mode="json"),
        )
        report_payload = self._extract_json(tool_result)
        validation_report = ValidationReport.model_validate({
            **report_payload,
            "prompt_alignment_score": prompt_alignment.score,
            "prompt_alignment_findings": [
                f"{item.status}: {item.requirement}" for item in prompt_alignment.coverage_items
                if item.status != "covered"
            ],
        })
        completed = _utc_now()
        receipt = ToolReceipt(
            tool_name="validate-deck-plan",
            tool_version="local-v3",
            status="succeeded",
            input_sha256=_sha256(planning_output.model_dump(mode="json")),
            output_sha256=_sha256(report_payload),
            started_at=started,
            completed_at=completed,
            safe_summary="AI-generated planning output passed schema, reference, stage-order, and page invariants",
        )
        return AgentPlan(
            execution_id=f"local-strands-{uuid4()}",
            sdk_version=importlib.metadata.version("strands-agents"),
            planning_output=planning_output,
            validation_report=validation_report,
            tool_receipts=[receipt],
        )

    def _run_calculation_stage(
        self,
        prompt_contract: PromptContract,
        formula_plan: FormulaPlan,
        context: dict[str, Any],
        workbook_profiles: list[dict[str, Any]],
    ) -> CalculationPlanningStageOutput:
        validation_error = ""
        previous_output: CalculationPlanningStageOutput | None = None
        for attempt in range(2):
            stage_context = dict(context)
            if validation_error:
                stage_context["retry_validation_error"] = validation_error
                if previous_output is not None:
                    stage_context["previous_calculation_stage_output"] = previous_output.model_dump(mode="json")
            output = self._run_stage(
                "calculation",
                CalculationPlanningStageOutput,
                CALCULATION_STAGE_PROMPT,
                stage_context,
            )
            try:
                self._validate_calculation_links(prompt_contract, formula_plan, output, workbook_profiles)
                return output
            except ValueError as error:
                previous_output = output
                self._emit_event({
                    "level": "warning",
                    "stage": "calculation",
                    "validation_attempt": attempt + 1,
                    "code": "STAGE_VALIDATION_RETRY",
                    "reason": str(error)[:300],
                })
                if attempt == 1:
                    raise
                validation_error = str(error)
        raise RuntimeError("calculation stage retry exhausted")

    def _run_composition_stage(
        self,
        prompt: str,
        prompt_contract: PromptContract,
        formula: FormulaPlanningStageOutput,
        calculation: CalculationPlanningStageOutput,
        context: dict[str, Any],
    ) -> tuple[DeckPlan, PresentationGenerationPlan, FiveStageExecutionPlan, PromptAlignmentValidation]:
        validation_error = ""
        for attempt in range(2):
            stage_context = dict(context)
            if validation_error:
                stage_context["retry_validation_error"] = validation_error
            deck_plan = self._run_stage(
                "composition",
                DeckPlan,
                COMPOSITION_STAGE_PROMPT,
                stage_context,
            )
            try:
                planning_output = AIPlanningOutput(
                    prompt_contract=prompt_contract,
                    formula_plan=formula.formula_plan,
                    calculation_plan=calculation.calculation_plan,
                    presentation_generation_plan=self._default_presentation_generation_plan(),
                    execution_plan=self._default_execution_plan(),
                    deck_plan=deck_plan,
                )
                validate_planning_output(planning_output)
                alignment = self._structural_prompt_alignment(planning_output)
                self._emit_event({
                    "level": "info",
                    "stage": "prompt-alignment",
                    "score": alignment.score,
                    "approved": alignment.approved,
                })
                return (
                    deck_plan,
                    planning_output.presentation_generation_plan,
                    planning_output.execution_plan,
                    alignment,
                )
            except ValueError as error:
                self._emit_event({
                    "level": "warning",
                    "stage": "composition",
                    "validation_attempt": attempt + 1,
                    "code": "STAGE_VALIDATION_RETRY",
                    "reason": str(error)[:300],
                })
                if attempt == 1:
                    raise
                validation_error = str(error)
        raise RuntimeError("composition stage retry exhausted")

    @staticmethod
    def _default_presentation_generation_plan() -> PresentationGenerationPlan:
        """Invariant delivery policy; the model need only plan data-dependent slides."""
        return PresentationGenerationPlan.model_validate({
            "template_analysis": {
                "template_required": True,
                "classification_rules": [
                    "Inspect layouts, placeholders, title patterns, and slide order to classify cover, content, section, appendix, and back-cover roles.",
                    "Preserve the selected template theme, dimensions, master layouts, and untouched editable objects.",
                ],
                "required_slide_roles": ["cover", "content", "back-cover"],
            },
            "python_generation": {
                "generation_steps": [
                    "Read the approved plan, calculation artifact, and classified template.",
                    "Generate the approved pages with python-pptx and bind charts only to calculation outputs.",
                    "Save an editable preview deck and run layout, page-count, and provenance checks.",
                ],
                "editable_object_requirements": ["Keep text, charts, and slide order editable in preview."],
                "fidelity_checks": ["Keep chart-to-text balance and preserve applicable template styling."],
            },
            "layout_consistency_rules": ["Use the matching classified template layout for each approved slide role."],
            "preview_editing": {
                "manual_editable_fields": ["text", "chart configuration", "slide order", "page count", "formula notes"],
                "revision_behavior": ["Manual JSON edits and natural-language edits both revalidate the complete plan before rendering."],
            },
            "provenance_display": {
                "required_fields": ["workbook file", "sheet", "source columns or ranges", "formula", "calculation steps", "result", "unit"],
            },
            "final_export_requirements": ["Render the approved editable PPTX and retain per-chart actual-data provenance."],
        })

    @staticmethod
    def _default_execution_plan() -> FiveStageExecutionPlan:
        return FiveStageExecutionPlan.model_validate({
            "stages": [
                {"stage_id": "understand", "stage_class": "understand", "objective": "Validate the editable prompt contract.", "planned_activities": ["Interpret requested outcome and constraints."], "required_inputs": ["user prompt"], "allowed_tool_categories": ["contract"], "required_outputs": ["prompt contract"], "validation_checks": ["schema validation"], "completion_criteria": ["requirements are captured"], "requires_user_approval": False},
                {"stage_id": "acquire", "stage_class": "acquire", "objective": "Profile approved workbook and template inputs.", "planned_activities": ["Inspect uploaded workbook and template metadata."], "required_inputs": ["uploaded files"], "allowed_tool_categories": ["data-read", "research"], "required_outputs": ["source references"], "validation_checks": ["only approved inputs are read"], "completion_criteria": ["sources are available"], "requires_user_approval": False},
                {"stage_id": "analyze", "stage_class": "analyze", "objective": "Generate and run deterministic calculations.", "planned_activities": ["Generate Python and execute it against workbook inputs."], "required_inputs": ["formula plan", "workbook"], "allowed_tool_categories": ["calculation", "analysis"], "required_outputs": ["calculation artifact"], "validation_checks": ["formula bindings and program output validation"], "completion_criteria": ["actual results are available"], "requires_user_approval": True},
                {"stage_id": "compose", "stage_class": "compose", "objective": "Map approved results to the deck plan.", "planned_activities": ["Assign narrative, charts, and evidence to slides."], "required_inputs": ["deck plan", "calculation artifact"], "allowed_tool_categories": ["deck-planning"], "required_outputs": ["render-ready slide specification"], "validation_checks": ["all required references are assigned"], "completion_criteria": ["page plan is complete"], "requires_user_approval": True},
                {"stage_id": "render-verify", "stage_class": "render-verify", "objective": "Render editable PPTX and verify output.", "planned_activities": ["Classify template, generate deck, and show browser preview."], "required_inputs": ["template", "approved plan", "calculation artifact"], "allowed_tool_categories": ["rendering", "inspection"], "required_outputs": ["editable PPTX", "preview", "provenance"], "validation_checks": ["page count, layout, and provenance checks"], "completion_criteria": ["final PPTX can be exported"], "requires_user_approval": True},
            ],
        })

    @staticmethod
    def _structural_prompt_alignment(planning_output: AIPlanningOutput) -> PromptAlignmentValidation:
        """Fast, non-blocking coverage signal for user-editable presentation choices.

        Formula, workbook, and reference integrity remain deterministic gates. This
        deliberately avoids a fifth LLM call merely to judge optional insights or
        layout wording, because the review UI lets the user edit those choices.
        """
        contract = planning_output.prompt_contract
        deck = planning_output.deck_plan
        slide_references = {
            "metric": {item for slide in deck.slides for item in slide.metric_ids},
            "chart": {item for slide in deck.slides for item in slide.chart_ids},
            "insight": {item for slide in deck.slides for item in slide.insight_ids},
            "custom": {item for slide in deck.slides for item in slide.custom_requirement_ids},
        }
        candidates = [
            ("metric", item.metric_id, item.name)
            for item in contract.metrics if item.origin == "explicit"
        ] + [
            ("chart", item.chart_id, item.title)
            for item in contract.charts if item.origin == "explicit"
        ] + [
            ("insight", item.insight_id, item.question)
            for item in contract.insights if item.origin == "explicit"
        ] + [
            ("custom", item.requirement_id, item.description)
            for item in contract.custom_requirements if item.origin == "explicit"
        ]
        coverage_items = []
        missing = []
        for kind, identifier, description in candidates:
            covered = identifier in slide_references[kind]
            coverage_items.append({
                "requirement": description,
                "status": "covered" if covered else "partial",
                "plan_references": [f"deck_plan.slides.{kind}_ids"] if covered else ["prompt_contract"],
                "rationale": "Assigned to a slide" if covered else "Captured in the editable plan but not assigned to a slide",
            })
            if not covered:
                missing.append(description)
        if not coverage_items:
            coverage_items.append({
                "requirement": "User prompt captured in the editable planning contract",
                "status": "covered",
                "plan_references": ["prompt_contract", "deck_plan"],
                "rationale": "No separately tagged explicit item requires slide assignment",
            })
        score = max(0, 100 - len(missing) * 20)
        return PromptAlignmentValidation(
            score=score,
            approved=not missing,
            coverage_items=coverage_items,
            missing_explicit_requirements=missing,
            summary=("Structural coverage complete" if not missing else "Some editable prompt items are not assigned to slides"),
        )

    @staticmethod
    def _lightweight_workbook_profiles(workbook_profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Keep model context independent of bulk workbook sample values."""
        lightweight: list[dict[str, Any]] = []
        for workbook in workbook_profiles:
            sheets: list[dict[str, Any]] = []
            for sheet in workbook.get("sheets", []):
                header = next(
                    (
                        row
                        for row in sheet.get("sample_rows", [])
                        if any(value not in (None, "") for value in row)
                    ),
                    [],
                )
                sheets.append({
                    "sheet_name": sheet.get("sheet_name"),
                    "max_rows_reported": sheet.get("max_rows_reported"),
                    "max_columns_reported": sheet.get("max_columns_reported"),
                    "column_headers": [
                        str(value).strip()[:120]
                        for value in header
                        if value not in (None, "") and str(value).strip()
                    ],
                })
            lightweight.append({
                "upload_id": workbook.get("upload_id"),
                "file_name": workbook.get("file_name"),
                "sheets": sheets,
            })
        return lightweight

    @staticmethod
    def _alignment_summary(planning_output: AIPlanningOutput) -> dict[str, Any]:
        """Preserve prompt coverage evidence without resending the full editable JSON."""
        contract = planning_output.prompt_contract
        return {
            "requirements": {
                "user_intent": contract.user_intent,
                "presentation_goal": contract.presentation_goal,
                "target_audience": contract.target_audience,
                "language": contract.language,
                "page_count": contract.recommended_page_count,
                "metrics": [{"id": item.metric_id, "name": item.name, "required": item.required} for item in contract.metrics],
                "charts": [{"id": item.chart_id, "title": item.title, "required": item.required} for item in contract.charts],
                "insights": [{"id": item.insight_id, "question": item.question, "required": item.required} for item in contract.insights],
                "constraints": contract.content_constraints,
                "outputs": contract.output_requirements,
                "custom_requirements": [{"id": item.requirement_id, "description": item.description} for item in contract.custom_requirements],
            },
            "formulas": [{"id": item.formula_id, "name": item.name, "expression": item.expression} for item in planning_output.formula_plan.formulas],
            "calculation_tasks": [{"id": item.task_id, "metric_id": item.output_metric_id, "formula_id": item.formula_id} for item in planning_output.calculation_plan.tasks],
            "delivery": {
                "template_required": planning_output.presentation_generation_plan.template_analysis.template_required,
                "manual_editable_fields": planning_output.presentation_generation_plan.preview_editing.manual_editable_fields,
                "natural_language_editing": planning_output.presentation_generation_plan.preview_editing.natural_language_editing,
                "provenance_fields": planning_output.presentation_generation_plan.provenance_display.required_fields,
                "final_exports": planning_output.presentation_generation_plan.final_export_requirements,
            },
            "deck": {
                "title": planning_output.deck_plan.title,
                "total_pages": planning_output.deck_plan.total_pages,
                "slides": [
                    {
                        "page": slide.page_number, "kind": slide.kind, "title": slide.title,
                        "goal": slide.communication_goal, "metrics": slide.metric_ids,
                        "formulas": slide.formula_ids, "charts": slide.chart_ids,
                        "insights": slide.insight_ids, "custom_requirements": slide.custom_requirement_ids,
                    }
                    for slide in planning_output.deck_plan.slides
                ],
            },
        }

    def _run_stage(
        self,
        stage_name: str,
        output_model: type[StageOutput],
        system_prompt: str,
        context: dict[str, Any],
    ) -> StageOutput:
        request = json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str)
        token_budgets = STAGE_TOKEN_BUDGETS[stage_name]
        stage_model = self._model_for_stage(stage_name)
        for attempt, token_budget in enumerate(token_budgets, start=1):
            stage_model.update_config(max_tokens=token_budget)
            self._emit_event({
                "level": "info",
                "stage": stage_name,
                "attempt": attempt,
                "status": "started",
                "tokenBudget": token_budget,
            })
            agent = Agent(
                model=stage_model,
                tools=[],
                system_prompt=system_prompt,
                callback_handler=None,
                load_tools_from_directory=False,
                name=f"Lobster {stage_name.title()} Planner",
            )
            stage_request = request
            if "retry_validation_error" in context:
                stage_request += (
                    "\nYour previous output failed deterministic validation. Correct this exact error before "
                    "returning the complete schema: " + str(context["retry_validation_error"])
                )
            if attempt > 1:
                stage_request += (
                    "\nThe previous response exceeded the stage output limit. Return the same complete schema "
                    "with shorter text and fewer optional items; never omit required fields."
                )
            try:
                result = agent(
                    stage_request,
                    structured_output_model=output_model,
                    idempotency_token=_sha256({"stage": stage_name, "attempt": attempt, "context": context}),
                )
            except MaxTokensReachedException as error:
                self._emit_event({
                    "level": "warning" if attempt < len(token_budgets) else "error",
                    "stage": stage_name,
                    "attempt": attempt,
                    "code": "EXPANDED_STAGE_RETRY" if attempt < len(token_budgets) else "STAGE_OUTPUT_TOO_LARGE",
                    "tokenBudget": token_budget,
                })
                if attempt < len(token_budgets):
                    continue
                raise StageOutputTooLargeError(stage_name, attempt, token_budget) from error
            except Exception as error:
                error_type = type(error).__name__
                if attempt < len(token_budgets) and self._is_transient_model_error(error_type):
                    self._emit_event({
                        "level": "warning",
                        "stage": stage_name,
                        "attempt": attempt,
                        "code": "MODEL_REQUEST_RETRY",
                        "errorType": error_type,
                    })
                    continue
                raise
            if result.structured_output is None:
                raise RuntimeError(f"Strands model did not return {stage_name} structured output")
            output = output_model.model_validate(result.structured_output)
            self._emit_event({"level": "info", "stage": stage_name, "attempt": attempt, "status": "completed"})
            return output
        raise RuntimeError(f"{stage_name} stage retry exhausted")

    @staticmethod
    def _is_transient_model_error(error_type: str) -> bool:
        """Classify transport/service failures that are safe to retry once.

        Validation failures are deliberately excluded: retrying the same data
        binding error wastes time and can conceal a real plan problem.
        """
        return error_type in {
            "ReadTimeoutError",
            "EndpointConnectionError",
            "ConnectionClosedError",
            "ServiceUnavailableException",
            "ThrottlingException",
            "ModelTimeoutException",
        }

    def _emit_event(self, event: dict[str, Any]) -> None:
        if self._active_job_id is not None:
            event = {**event, "jobId": self._active_job_id}
        print(json.dumps(event, ensure_ascii=False))

    @staticmethod
    def _validate_calculation_links(
        prompt_contract: PromptContract,
        formula_plan: FormulaPlan,
        output: CalculationPlanningStageOutput,
        workbook_profiles: list[dict[str, Any]],
    ) -> None:
        metric_ids = {metric.metric_id for metric in prompt_contract.metrics}
        formula_ids = {formula.formula_id for formula in formula_plan.formulas}
        task_ids = {task.task_id for task in output.calculation_plan.tasks}
        calculated_metric_ids = {task.output_metric_id for task in output.calculation_plan.tasks}
        required_calculations = {
            metric.metric_id for metric in prompt_contract.metrics if metric.calculation_required
        }
        missing_calculations = required_calculations - calculated_metric_ids
        if missing_calculations:
            raise ValueError(
                "calculation stage omitted tasks for calculation-required metrics: "
                f"missing_metric_ids={','.join(sorted(missing_calculations))}"
            )
        for task in output.calculation_plan.tasks:
            if task.output_metric_id not in metric_ids:
                raise ValueError(f"calculation task {task.task_id} references an unknown metric")
            if task.formula_id not in formula_ids:
                raise ValueError(f"calculation task {task.task_id} references an unknown formula")
            formula = next(item for item in formula_plan.formulas if item.formula_id == task.formula_id)
            expected = {item.symbol for item in formula.variables}
            actual = {item.variable for item in task.input_bindings}
            if expected != actual or len(task.input_bindings) != len(actual):
                missing = ",".join(sorted(expected - actual)) or "none"
                unexpected = ",".join(sorted(actual - expected)) or "none"
                duplicates = len(task.input_bindings) - len(actual)
                raise ValueError(
                    f"calculation task {task.task_id} bindings do not match formula {formula.formula_id}: "
                    f"expected={','.join(sorted(expected))}; actual={','.join(sorted(actual))}; "
                    f"missing={missing}; unexpected={unexpected}; duplicate_count={duplicates}"
                )
        chart_ids = {chart.chart_id for chart in prompt_contract.charts}
        linked_chart_ids = {link.chart_id for link in output.chart_calculation_links}
        if linked_chart_ids - chart_ids:
            raise ValueError("calculation stage links an unknown chart")
        if linked_chart_ids != chart_ids:
            raise ValueError("calculation stage must return one chart calculation link for every chart")
        chart_formula_ids = {item for link in output.chart_calculation_links for item in link.formula_ids}
        chart_task_ids = {item for link in output.chart_calculation_links for item in link.calculation_task_ids}
        if chart_formula_ids - formula_ids:
            raise ValueError("calculation stage chart links reference unknown formulas")
        if chart_task_ids - task_ids:
            raise ValueError("calculation stage chart links reference unknown tasks")
        for link in output.chart_calculation_links:
            linked_task_formula_ids = {
                task.formula_id for task in output.calculation_plan.tasks if task.task_id in link.calculation_task_ids
            }
            if not linked_task_formula_ids.issubset(set(link.formula_ids)):
                raise ValueError(f"chart calculation link {link.chart_id} omits a formula used by its task")
        if not workbook_profiles:
            return
        uploads = {profile["upload_id"]: profile for profile in workbook_profiles}
        for task in output.calculation_plan.tasks:
            for binding in task.input_bindings:
                profile = uploads.get(binding.workbook_upload_id)
                if profile is None:
                    raise ValueError(f"calculation task {task.task_id} uses an uploaded workbook not present in the request")
                if binding.workbook_selector != profile["file_name"]:
                    raise ValueError(f"calculation task {task.task_id} must use the exact workbook file name from the profile")
                sheet = next((item for item in profile["sheets"] if item["sheet_name"] == binding.sheet_selector), None)
                if sheet is None:
                    raise ValueError(f"calculation task {task.task_id} uses a sheet not present in the workbook profile")
                header_columns = {
                    str(value).strip()
                    for value in sheet.get("column_headers", [])
                    if value not in (None, "") and str(value).strip()
                }
                if not header_columns:
                    header = next(
                        (
                            row
                            for row in sheet.get("sample_rows", [])
                            if any(value not in (None, "") for value in row)
                        ),
                        [],
                    )
                    header_columns = {
                        str(value).strip()
                        for value in header
                        if value not in (None, "") and str(value).strip()
                    }
                if binding.column_selector not in header_columns:
                    allowed = ",".join(sorted(header_columns)[:40])
                    raise ValueError(
                        f"calculation task {task.task_id} variable {binding.variable} uses unknown column "
                        f"{binding.column_selector!r} on sheet {binding.sheet_selector!r}; "
                        f"choose exactly one header column: {allowed}"
                    )

    @staticmethod
    def _attach_calculation_links(
        prompt_contract: PromptContract,
        output: CalculationPlanningStageOutput,
    ) -> PromptContract:
        links = {link.chart_id: link for link in output.chart_calculation_links}
        payload = prompt_contract.model_dump(mode="json")
        for chart in payload["charts"]:
            link = links.get(chart["chart_id"])
            chart["formula_ids"] = list(link.formula_ids) if link else []
            chart["calculation_task_ids"] = list(link.calculation_task_ids) if link else []
        return PromptContract.model_validate(payload)

    @staticmethod
    def _without_calculation_links(prompt_contract: PromptContract) -> PromptContract:
        payload = prompt_contract.model_dump(mode="json")
        for chart in payload["charts"]:
            chart["formula_ids"] = []
            chart["calculation_task_ids"] = []
        return PromptContract.model_validate(payload)

    def execute(self, planning_output: AIPlanningOutput, *, attempt: int = 1) -> StageManifest:
        report = self._validate_direct(planning_output)
        output = {"planning_output": planning_output.model_dump(mode="json"), "validation": report.model_dump(mode="json")}
        manifest = StageManifest(
            execution_id=f"local-strands-{uuid4()}",
            stage_id="ai-planning",
            context_version=1,
            attempt=attempt,
            status="succeeded",
            output_sha256=_sha256(output),
            tool_receipts=[],
        )
        self._manifests[(manifest.context_version, attempt)] = manifest
        return manifest

    def resume(self, context_version: int, attempt: int) -> StageManifest:
        try:
            return self._manifests[(context_version, attempt)].model_copy(deep=True)
        except KeyError as error:
            raise LookupError("no committed local manifest for context version and attempt") from error

    def cancel(self, execution_id: str, stage_id: str) -> CancellationReceipt:
        if not execution_id or not stage_id:
            raise ValueError("execution_id and stage_id are required")
        return CancellationReceipt(execution_id=execution_id, stage_id=stage_id, cancelled_at=_utc_now())

    def _validate_direct(self, planning_output: AIPlanningOutput) -> ValidationReport:
        result = self._agent.tool.validate_deck_plan(
            record_direct_tool_call=False,
            planning_output=planning_output.model_dump(mode="json"),
        )
        return ValidationReport.model_validate(self._extract_json(result))

    @staticmethod
    def _extract_json(tool_result: dict[str, Any]) -> dict[str, Any]:
        if tool_result.get("status") != "success":
            raise RuntimeError("Strands validation tool failed")
        for block in tool_result.get("content", []):
            if isinstance(block, dict) and isinstance(block.get("json"), dict):
                return block["json"]
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parsed = json.loads(block["text"])
                if isinstance(parsed, dict):
                    return parsed
        raise RuntimeError("Strands validation tool did not return a JSON object")
