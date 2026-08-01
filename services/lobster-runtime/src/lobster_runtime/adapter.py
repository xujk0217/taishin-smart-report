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

from .contracts import (
    AIPlanningOutput,
    AgentPlan,
    CalculationPlanningStageOutput,
    CancellationReceipt,
    CompositionPlanningStageOutput,
    FormulaPlan,
    FormulaPlanningStageOutput,
    PromptAlignmentValidation,
    PromptContract,
    RequirementsPlanningStageOutput,
    StageManifest,
    ToolReceipt,
    ValidationReport,
)
from .planner import validate_deck_plan_tool, validate_planning_output


ALLOWED_TOOLS = frozenset({"validate-deck-plan"})

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

OUTPUT BUDGET: Return a complete but compact JSON object. Never repeat the same explanation across fields.
Unless the user explicitly needs more, use at most 8 metrics, 8 charts, 8 insights, 6 formulas, 6 calculation
tasks, and 4 custom requirements. Keep ordinary list fields to 1-4 short items, keep custom_fields empty unless
they carry a truly novel requirement, and keep each slide's text, evidence, and visual instructions concise.
The slide plan must still contain exactly the approved page count. Prefer stable identifiers and references
over copying long prose. Completeness means every required schema field is present, not that every field is long.

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
more than 8 metrics, 8 charts, 8 insights, and 4 custom requirements, with short text fields. When revising,
apply the user's instruction to the supplied previous stage while preserving unaffected requirements.
""".strip()

FORMULA_STAGE_PROMPT = """
You are stage 2 of a presentation planning pipeline. Using the approved PromptContract and actual workbook
profiles, return FormulaPlanningStageOutput only. Define only the formula plan needed for the requested
metrics and charts. Do not calculate values or create Excel tasks in this stage. Formula sources may be user
provided, workbook-derived, model knowledge, or controlled web research; anything not retrieved must remain
unverified. Keep at most 6 formulas unless explicitly required, and keep explanations short. When revising,
apply the user's instruction to the supplied previous formula plan while preserving unaffected work.
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
and openpyxl, read-only inputs, no network. Keep lists and explanations short.
On a correction request, use previous_calculation_stage_output as the baseline. Preserve every valid task and
chart link; change only the named invalid task or link. Copy the formula variable symbols character-for-character:
aliases, display labels, additional bindings, and duplicate bindings are invalid. When revising, apply the user's
instruction to the supplied previous calculation plan while preserving unaffected work.
""".strip()

COMPOSITION_STAGE_PROMPT = """
You are stage 3 of a presentation planning pipeline. Using the approved requirement, formula, and calculation
stages, return CompositionPlanningStageOutput only. Produce exactly the approved number of slides, starting
with a cover and ending with a back cover, and reference only identifiers that exist in the supplied stages.
Assign every required metric, chart, insight, custom requirement, and required formula to at least one slide.
Also plan Python PPTX template inspection, editable generation, browser preview/manual and natural-language
editing, per-chart actual-data provenance, and final export. The five execution stages must follow understand,
acquire, analyze, compose, render-verify and their allowed tool categories. Never add synthetic data. Keep each
slide and policy field concise; prefer identifiers over repeated prose. When revising, apply the user's
instruction to the supplied previous stage while preserving unaffected work.
""".strip()

PROMPT_ALIGNMENT_STAGE_PROMPT = """
You are an independent prompt-to-plan validator. Compare the original user prompt with the complete proposed
AIPlanningOutput. Return PromptAlignmentValidation only; do not modify the plan and do not invent requirements.
List every explicit user requirement that materially affects the requested deck, calculations, data provenance,
template handling, output, or editing. Mark it covered only when the plan has a concrete relevant field or ID.
Use partial or missing when coverage is vague. approved may be true only when every explicit requirement is
covered and missing_explicit_requirements is empty. Score semantic coverage from 0 to 100 and keep this compact.
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
    ) -> AgentPlan: ...
    def execute(self, planning_output: AIPlanningOutput, *, attempt: int = 1) -> StageManifest: ...
    def resume(self, context_version: int, attempt: int) -> StageManifest: ...
    def cancel(self, execution_id: str, stage_id: str) -> CancellationReceipt: ...


class StrandsLobsterRuntimeAdapter:
    """AI-driven planner with registry-only deterministic validation.

    A model must be injected explicitly. This class never selects a provider, reads environment
    configuration, or falls back to heuristic planning.
    """

    def __init__(self, model: Model) -> None:
        self._model = model
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

    @property
    def registered_tools(self) -> frozenset[str]:
        return frozenset(self._agent.tool_names)

    def plan(
        self,
        prompt: str,
        *,
        workbook_context: list[dict[str, Any]] | None = None,
        previous_planning_output: AIPlanningOutput | dict[str, Any] | None = None,
    ) -> AgentPlan:
        normalized = " ".join(prompt.split())
        if not normalized:
            raise ValueError("prompt must not be blank")

        previous = (
            AIPlanningOutput.model_validate(previous_planning_output)
            if previous_planning_output is not None
            else None
        )
        workbook_profiles = workbook_context or []
        requirements_context: dict[str, Any] = {
            "user_prompt": normalized,
            "workbook_profiles": workbook_profiles,
        }
        if previous is not None:
            requirements_context["previous_prompt_contract"] = previous.prompt_contract.model_dump(mode="json")
        requirements = self._run_stage(
            "requirements",
            RequirementsPlanningStageOutput,
            REQUIREMENTS_STAGE_PROMPT,
            requirements_context,
        )
        requirements_contract = self._without_calculation_links(requirements.prompt_contract)

        formula_context: dict[str, Any] = {
            "user_prompt": normalized,
            "workbook_profiles": workbook_profiles,
            "prompt_contract": requirements_contract.model_dump(mode="json"),
        }
        if previous is not None:
            formula_context["previous_formula_plan"] = previous.formula_plan.model_dump(mode="json")
        formula = self._run_stage(
            "formula",
            FormulaPlanningStageOutput,
            FORMULA_STAGE_PROMPT,
            formula_context,
        )

        calculation_context: dict[str, Any] = {
            "user_prompt": normalized,
            "workbook_profiles": workbook_profiles,
            "prompt_contract": requirements_contract.model_dump(mode="json"),
            "formula_plan": formula.formula_plan.model_dump(mode="json"),
        }
        if previous is not None:
            calculation_context["previous_calculation_plan"] = previous.calculation_plan.model_dump(mode="json")
        calculation = self._run_calculation_stage(
            requirements_contract,
            formula.formula_plan,
            calculation_context,
            workbook_profiles,
        )
        prompt_contract = self._attach_calculation_links(requirements_contract, calculation)

        composition_context: dict[str, Any] = {
            "user_prompt": normalized,
            "prompt_contract": prompt_contract.model_dump(mode="json"),
            "formula_plan": formula.formula_plan.model_dump(mode="json"),
            "calculation_plan": calculation.calculation_plan.model_dump(mode="json"),
        }
        if previous is not None:
            composition_context["previous_presentation_generation_plan"] = previous.presentation_generation_plan.model_dump(mode="json")
            composition_context["previous_execution_plan"] = previous.execution_plan.model_dump(mode="json")
            composition_context["previous_deck_plan"] = previous.deck_plan.model_dump(mode="json")
        composition, prompt_alignment = self._run_composition_stage(
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
            presentation_generation_plan=composition.presentation_generation_plan,
            execution_plan=composition.execution_plan,
            deck_plan=composition.deck_plan,
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
                print(json.dumps({
                    "level": "warning",
                    "stage": "calculation",
                    "validation_attempt": attempt + 1,
                    "code": "STAGE_VALIDATION_RETRY",
                    "reason": str(error)[:300],
                }))
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
    ) -> tuple[CompositionPlanningStageOutput, PromptAlignmentValidation]:
        validation_error = ""
        for attempt in range(2):
            stage_context = dict(context)
            if validation_error:
                stage_context["retry_validation_error"] = validation_error
            output = self._run_stage(
                "composition",
                CompositionPlanningStageOutput,
                COMPOSITION_STAGE_PROMPT,
                stage_context,
            )
            try:
                planning_output = AIPlanningOutput(
                    prompt_contract=prompt_contract,
                    formula_plan=formula.formula_plan,
                    calculation_plan=calculation.calculation_plan,
                    presentation_generation_plan=output.presentation_generation_plan,
                    execution_plan=output.execution_plan,
                    deck_plan=output.deck_plan,
                )
                validate_planning_output(planning_output)
                alignment = self._run_prompt_alignment(prompt, planning_output)
                print(json.dumps({
                    "level": "info",
                    "stage": "prompt-alignment",
                    "score": alignment.score,
                    "approved": alignment.approved,
                }))
                if not alignment.approved:
                    missing = "; ".join(alignment.missing_explicit_requirements[:6])
                    raise ValueError(f"prompt alignment has missing explicit requirements: {missing}")
                return output, alignment
            except ValueError as error:
                print(json.dumps({
                    "level": "warning",
                    "stage": "composition",
                    "validation_attempt": attempt + 1,
                    "code": "STAGE_VALIDATION_RETRY",
                    "reason": str(error)[:300],
                }))
                if attempt == 1:
                    raise
                validation_error = str(error)
        raise RuntimeError("composition stage retry exhausted")

    def _run_prompt_alignment(
        self,
        prompt: str,
        planning_output: AIPlanningOutput,
    ) -> PromptAlignmentValidation:
        return self._run_stage(
            "prompt-alignment",
            PromptAlignmentValidation,
            PROMPT_ALIGNMENT_STAGE_PROMPT,
            {
                "original_prompt": prompt,
                "planning_output": planning_output.model_dump(mode="json"),
            },
        )

    def _run_stage(
        self,
        stage_name: str,
        output_model: type[StageOutput],
        system_prompt: str,
        context: dict[str, Any],
    ) -> StageOutput:
        request = json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str)
        for attempt in range(2):
            print(json.dumps({"level": "info", "stage": stage_name, "attempt": attempt + 1, "status": "started"}))
            agent = Agent(
                model=self._model,
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
            if attempt:
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
            except Exception as error:
                if type(error).__name__ != "MaxTokensReachedException" or attempt == 1:
                    raise
                print(json.dumps({"level": "warning", "stage": stage_name, "code": "COMPACT_STAGE_RETRY"}))
                continue
            if result.structured_output is None:
                raise RuntimeError(f"Strands model did not return {stage_name} structured output")
            output = output_model.model_validate(result.structured_output)
            print(json.dumps({"level": "info", "stage": stage_name, "attempt": attempt + 1, "status": "completed"}))
            return output
        raise RuntimeError(f"{stage_name} stage retry exhausted")

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
                visible_values = {
                    str(value) for row in sheet.get("sample_rows", []) for value in row if value not in (None, "")
                }
                if binding.column_selector not in visible_values:
                    raise ValueError(f"calculation task {task.task_id} uses a column not visible in the workbook profile")

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
