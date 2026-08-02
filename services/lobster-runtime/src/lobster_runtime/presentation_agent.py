"""Agent-led presentation generation through controlled python-pptx code."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import linecache
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel
from strands import Agent
from strands.models import Model

from .artifact_validator import validate_artifacts
from .presentation_contracts import (
    ArtifactFinding,
    ArtifactValidationReport,
    EvidencePacketV2,
    PresentationBlueprint,
    PythonRendererProgram,
    RenderArtifactManifest,
    TemplateProfile,
)
from .render_code_guard import validate_renderer_source
from .smart_report_pptx import Deck, RenderingContext
from .template_analyzer import analyze_template


PRESENTATION_RENDERER_PROMPT = """
You are the presentation rendering agent. Generate Python code that creates a native editable PPTX and
the synchronized XLSX data workbook for the approved presentation blueprint.

Prefer the controlled Deck wrapper for reliable template-aware text, metric, chart, and table rendering;
it uses python-pptx internally and produces editable PowerPoint objects. Deck.add_slide(...) chooses the
closest uploaded template layout by role, and slide.add_title(...) fills an existing template title text
frame when one exists. Use native python-pptx directly only when you need a capability the Deck wrapper
does not expose.

When using Deck, finish with deck.save(). When using native python-pptx directly, use ctx.new_workbook()
for the synchronized data workbook and finish with ctx.save_artifacts(presentation, workbook,
chart_count=..., table_count=..., evidence_refs_used=[...]).

Deck public API only:
- deck = Deck.from_context(ctx)
- slide = deck.add_slide(role="cover" | "content" | "section" | "appendix" | "back-cover", layout_name="optional exact template layout name")
- slide.add_title(text, box=(x, y, w, h))
- slide.add_subtitle(text, box=(x, y, w, h))
- slide.add_free_text(text, box=(x, y, w, h))
- slide.add_text(text, box=(x, y, w, h))
- slide.add_bullet_list(items=[...], box=(x, y, w, h))
- slide.add_metric_card(metric_ref="...", box=(x, y, w, h))
- slide.add_claim(claim_ref="...", box=(x, y, w, h))
- slide.add_chart(chart_ref="...", box=(x, y, w, h))
- slide.add_table(table_ref="...", box=(x, y, w, h))
- return deck.save()

Allowed imports include:
- from pptx import Presentation
- from pptx.util import Inches, Pt
- from pptx.chart.data import CategoryChartData
- from pptx.enum.chart import XL_CHART_TYPE
- from pptx.enum.text import PP_ALIGN
- from pptx.dml.color import RGBColor
- from openpyxl import Workbook
- from lobster_runtime.smart_report_pptx import Deck

Hard rules:
- Return PythonRendererProgram only.
- The code must define render(ctx).
- Do not read external files, write arbitrary files, use network, shell out, eval, exec, or open().
- Do not calculate business metrics or create new evidence. Use only ctx.metrics, ctx.charts, ctx.claims, ctx.tables.
- Do not hard-code material content numbers in visible text. Render numbers through ctx.metrics/ctx.claims or charts/tables.
- Preserve the approved slide count and follow the blueprint intent.
- Do not use slide.shapes.title. Some layouts have no title placeholder and this causes NoneType errors.
  Use slide.shapes.add_textbox(...) for titles, or iterate over existing shapes and check has_text_frame.
- Do not read or assign any object's .title attribute. Use explicit strings from the blueprint/evidence,
  dictionary lookups like chart["title"], or slide.add_title(...) on the Deck wrapper.
- Do not index slide.placeholders or assume any placeholder exists. Do not manage template placeholders yourself;
  use deck.add_slide(...) and slide.add_title(...) so the wrapper fills suitable template text frames.
- Do not use private attributes or wrapper internals: no ._slide, ._element, .slide, .presentation, or .workbook.
  With the Deck wrapper, only call the public methods listed above.
- For charts, create native editable PowerPoint charts with CategoryChartData and slide.shapes.add_chart(...).
  Do not draw chart-like graphics with rectangles, lines, screenshots, or pictures. Mirror every chart/table's
  underlying data into the output workbook.

Preferred safe pattern:
from lobster_runtime.smart_report_pptx import Deck
def render(ctx):
    deck = Deck.from_context(ctx)
    slide = deck.add_slide(role="cover")
    slide.add_title("Approved title", box=(0.7, 0.7, 10.8, 0.8))
    slide.add_claim(claim_ref="claim_slide_1", box=(0.9, 1.8, 8.5, 1.0))
    return deck.save()

Native fallback pattern:
def put_text(slide, text, left, top, width, height):
    box = slide.shapes.add_textbox(left, top, width, height)
    box.text_frame.text = text
    return box

Forbidden patterns:
- slide.shapes.title.text = ...
- title_shape = slide.shapes.title; title_shape.text = ...
- layout.title, shape.title, placeholder.title, or any_object.title
- slide.placeholders[0] or slide.placeholders[1]
- slide._slide, slide.slide, deck.presentation, deck.workbook, or any private/internal attribute
""".strip()


class AgentPresentationResult(BaseModel):
    execution_id: str
    sdk_version: str
    template_profile: TemplateProfile
    renderer_program: PythonRendererProgram
    manifest: RenderArtifactManifest
    validation_report: ArtifactValidationReport


class AgentPresentationRuntime:
    """Generate PPTX/XLSX artifacts from an approved plan using agent-written Python."""

    def __init__(self, model: Model) -> None:
        self._model = model

    def generate(
        self,
        *,
        prompt: str,
        blueprint: PresentationBlueprint | dict[str, Any],
        evidence: EvidencePacketV2 | dict[str, Any],
        output_dir: str | Path,
        template_path: str | Path | None = None,
        file_stem: str = "agent-generated-presentation",
        expected_slide_count: int | None = None,
    ) -> AgentPresentationResult:
        parsed_blueprint = PresentationBlueprint.model_validate(blueprint)
        parsed_evidence = EvidencePacketV2.model_validate(evidence)
        template_profile = analyze_template(template_path)
        validation_error = ""
        last_program: PythonRendererProgram | None = None
        for attempt in range(3):
            program = self._generate_program(
                prompt=prompt,
                blueprint=parsed_blueprint,
                evidence=parsed_evidence,
                template_profile=template_profile,
                validation_error=validation_error,
            )
            last_program = program
            try:
                validate_renderer_source(program.source_code)
                manifest = self._execute_program(
                    program,
                    evidence=parsed_evidence,
                    output_dir=output_dir,
                    template_path=template_path,
                    file_stem=file_stem,
                )
                report = _with_blueprint_checks(
                    validate_artifacts(manifest),
                    manifest,
                    expected_slide_count=expected_slide_count,
                )
                if report.status == "failed_validation":
                    validation_error = "; ".join(f"{f.code}: {f.message}" for f in report.findings[:6])
                    if attempt == 0:
                        continue
                return AgentPresentationResult(
                    execution_id=f"presentation-agent-{uuid4()}",
                    sdk_version=importlib.metadata.version("strands-agents"),
                    template_profile=template_profile,
                    renderer_program=program,
                    manifest=manifest,
                    validation_report=report,
                )
            except Exception as error:
                validation_error = _format_renderer_error(error, program.source_code)
                if attempt == 2:
                    raise
        raise RuntimeError(f"presentation generation failed after retries: {last_program!r}")

    def _generate_program(
        self,
        *,
        prompt: str,
        blueprint: PresentationBlueprint,
        evidence: EvidencePacketV2,
        template_profile: TemplateProfile,
        validation_error: str,
    ) -> PythonRendererProgram:
        context = {
            "user_prompt": " ".join(prompt.split()),
            "presentation_blueprint": blueprint.model_dump(mode="json"),
            "evidence_catalog": {
                "metrics": [metric.model_dump(mode="json") for metric in evidence.metrics],
                "charts": [chart.model_dump(mode="json") for chart in evidence.charts],
                "claims": [claim.model_dump(mode="json") for claim in evidence.claims],
                "tables": [table.model_dump(mode="json") for table in evidence.tables],
            },
            "template_profile": template_profile.model_dump(mode="json"),
        }
        if validation_error:
            context["previous_validation_error"] = validation_error
        agent = Agent(
            model=self._model,
            tools=[],
            system_prompt=PRESENTATION_RENDERER_PROMPT,
            callback_handler=None,
            load_tools_from_directory=False,
            name="Lobster Python PPTX Renderer Agent",
        )
        result = agent(
            json.dumps(context, ensure_ascii=False, separators=(",", ":")),
            structured_output_model=PythonRendererProgram,
            idempotency_token=_sha256(context),
        )
        if result.structured_output is None:
            raise RuntimeError("renderer agent did not return PythonRendererProgram")
        return PythonRendererProgram.model_validate(result.structured_output)

    @staticmethod
    def _execute_program(
        program: PythonRendererProgram,
        *,
        evidence: EvidencePacketV2,
        output_dir: str | Path,
        template_path: str | Path | None,
        file_stem: str,
    ) -> RenderArtifactManifest:
        ctx = RenderingContext(
            evidence=evidence,
            output_dir=output_dir,
            template_path=template_path,
            file_stem=file_stem,
        )
        namespace: dict[str, Any] = {
            "__name__": "agent_generated_renderer",
            "Deck": Deck,
        }
        exec(compile(program.source_code, "<agent-generated-renderer>", "exec"), namespace)
        render = namespace.get(program.entrypoint)
        if not callable(render):
            raise ValueError("generated renderer entrypoint is not callable")
        manifest = render(ctx)
        if manifest is None and ctx.last_deck is not None:
            manifest = ctx.last_deck.save()
        if manifest is None and ctx.last_presentation is not None:
            manifest = ctx.save_artifacts(ctx.last_presentation, ctx.last_workbook)
        return RenderArtifactManifest.model_validate(manifest)


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _format_renderer_error(error: Exception, source_code: str) -> str:
    lines = source_code.splitlines()
    generated_line = ""
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename == "<agent-generated-renderer>" and frame.lineno:
            start = max(1, frame.lineno - 2)
            end = min(len(lines), frame.lineno + 2)
            excerpt = "\n".join(f"{line_no}: {lines[line_no - 1]}" for line_no in range(start, end + 1))
            generated_line = f"\nGenerated code around failing line:\n{excerpt}"
            break
    message = f"{type(error).__name__}: {error}{generated_line}"
    if "title" in message and ("NoneType" in message or "not allowed" in message):
        message += (
            "\nCorrection rule: remove every .title attribute access. Use Deck.add_title(...) "
            "or slide.shapes.add_textbox(...). Do not use slide.shapes.title, layout.title, "
            "shape.title, placeholder.title, or slide.placeholders[index]."
        )
    if "_slide" in message or "private attributes" in message or "wrapper internals" in message:
        message += (
            "\nCorrection rule: do not access Deck wrapper internals like slide._slide, slide.slide, "
            "deck.presentation, or deck.workbook. Use only Deck.from_context(ctx), deck.add_slide(...), "
            "slide.add_title/add_text/add_claim/add_metric_card/add_chart/add_table, and deck.save()."
        )
    return message


def _with_blueprint_checks(
    report: ArtifactValidationReport,
    manifest: RenderArtifactManifest,
    *,
    expected_slide_count: int | None,
) -> ArtifactValidationReport:
    findings = list(report.findings)
    if expected_slide_count is not None and manifest.slide_count != expected_slide_count:
        findings.append(ArtifactFinding(
            severity="blocking",
            code="APPROVED_SLIDE_COUNT_MISMATCH",
            message=f"Generated PPTX has {manifest.slide_count} slides, but the approved blueprint has {expected_slide_count} slides",
            origin_stage="artifact-validation",
        ))
    status = "failed_validation" if any(finding.severity == "blocking" for finding in findings) else report.status
    return ArtifactValidationReport(
        status=status,
        findings=findings,
        checked_slide_count=report.checked_slide_count,
        checked_chart_count=report.checked_chart_count,
        checked_table_count=report.checked_table_count,
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
