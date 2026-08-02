"""End-to-end real-agent pipeline for universal data-to-presentation generation."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, TypeVar

from botocore.config import Config
from pydantic import BaseModel
from strands import Agent
from strands.models import BedrockModel, Model

from .presentation_agent import AgentPresentationRuntime
from .presentation_contracts import EvidencePacketV2, PresentationBlueprint
from .template_analyzer import analyze_template
from .universal_data_tools import profile_excel_files
from .universal_pipeline_contracts import (
    AnalysisFeasibilityPlan,
    BlueprintStageOutput,
    DataIntelligenceReport,
    FullPipelineManifest,
    VerifiedAnalysisNarrative,
)


DEFAULT_MODEL_ID = "amazon.nova-pro-v1:0"
StageOutput = TypeVar("StageOutput", bound=BaseModel)


DATA_STAGE_PROMPT = """
You are stage 1: data intelligence. Interpret the actual workbook profiles only.
Do not calculate new numbers and do not write presentation conclusions. Return DataIntelligenceReport.
Mark blocked only when the data cannot support any presentation work.
""".strip()

FEASIBILITY_STAGE_PROMPT = """
You are stage 2: analysis feasibility. Use the user prompt, data report, and workbook profiles to decide
which analyses are worthwhile and feasible. Do not invent results or calculate values. Return AnalysisFeasibilityPlan.
Accept only analyses that can be reproduced by deterministic tools from the visible data profile.
""".strip()

VERIFIED_ANALYSIS_STAGE_PROMPT = """
You are stage 3: verified analysis narrative. Use only the supplied EvidencePacketV2 and feasibility plan.
Summarize supported insights and caveats. Do not introduce unreferenced numbers. Return VerifiedAnalysisNarrative.
""".strip()

EVIDENCE_DISCOVERY_STAGE_PROMPT = """
You are the evidence discovery agent. Explore the workbook profiles, data intelligence report, feasibility plan,
and user prompt to construct EvidencePacketV2 for a management presentation.

Create evidence that is useful for charts, tables, claims, and metrics. Use the visible workbook profile values,
column names, examples, numeric summaries, and source references only. Do not invent source files or unsupported
columns. Every metric, chart, table, and claim must include traceable source_refs or metric/chart refs where
applicable. Prefer evidence that supports trends, anomalies, comparisons, and recommended actions.
""".strip()

BLUEPRINT_STAGE_PROMPT = """
You are stage 4: template binding and presentation design. Create a flexible PresentationBlueprint inside
BlueprintStageOutput. Use the template profile and evidence catalog. You may freely choose slide structure,
element positions, chart/text/table balance, and story flow, but every chart/table/claim/metric element must
reference an existing ID from the evidence catalog. Do not write material content numbers in free text.
Do not impose a slide-count cap unless the user explicitly requested one. If no count is requested, choose the
natural length for a complete management report, usually 10 to 14 slides. Cover executive summary, data scope,
method/evidence caveats, key trends, anomalies, institution/category comparison, implications, recommended
actions, and appendix/detail slides as needed.
""".strip()


class UniversalPresentationPipeline:
    def __init__(self, model: Model) -> None:
        self._model = model

    def run(
        self,
        *,
        prompt: str,
        data_paths: list[str | Path],
        output_dir: str | Path,
        template_path: str | Path | None = None,
        file_stem: str = "universal-agent-presentation",
    ) -> FullPipelineManifest:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        _log("Profiling Excel workbooks")
        profiles = profile_excel_files(data_paths)
        profile_payload = [profile.model_dump(mode="json") for profile in profiles]
        data_report = self._run_stage(
            "data-intelligence",
            DataIntelligenceReport,
            DATA_STAGE_PROMPT,
            {"user_prompt": prompt, "workbook_profiles": profile_payload},
        )
        self._ensure_not_blocked(data_report.status, "data-intelligence")

        _log("Building analysis feasibility plan")
        feasibility_plan = self._run_stage(
            "analysis-feasibility",
            AnalysisFeasibilityPlan,
            FEASIBILITY_STAGE_PROMPT,
            {
                "user_prompt": prompt,
                "data_report": data_report.model_dump(mode="json"),
                "workbook_profiles": profile_payload,
            },
        )
        self._ensure_not_blocked(feasibility_plan.status, "analysis-feasibility")

        _log("Discovering evidence with agent")
        evidence = self._run_evidence_stage(
            prompt=prompt,
            data_report=data_report,
            feasibility_plan=feasibility_plan,
            profile_payload=profile_payload,
        )
        evidence_path = output_path / f"{file_stem}.evidence.json"
        evidence_path.write_text(evidence.model_dump_json(indent=2), encoding="utf-8")

        _log("Writing verified analysis narrative")
        verified_narrative = self._run_stage(
            "verified-analysis",
            VerifiedAnalysisNarrative,
            VERIFIED_ANALYSIS_STAGE_PROMPT,
            {
                "user_prompt": prompt,
                "feasibility_plan": feasibility_plan.model_dump(mode="json"),
                "evidence_catalog": _compact_evidence_catalog(evidence),
            },
        )
        self._ensure_not_blocked(verified_narrative.status, "verified-analysis")

        _log("Analyzing PowerPoint template")
        template_profile = analyze_template(template_path)
        _log("Designing presentation blueprint")
        blueprint_output = self._run_blueprint_stage(
            prompt=prompt,
            data_report=data_report,
            feasibility_plan=feasibility_plan,
            verified_narrative=verified_narrative,
            evidence=evidence,
            template_profile=template_profile.model_dump(mode="json"),
        )
        self._ensure_not_blocked(blueprint_output.status, "presentation-design")
        blueprint_path = output_path / f"{file_stem}.blueprint.json"
        blueprint_path.write_text(blueprint_output.blueprint.model_dump_json(indent=2), encoding="utf-8")

        _log("Generating and executing python-pptx renderer")
        render_result = AgentPresentationRuntime(self._model).generate(
            prompt=prompt,
            blueprint=blueprint_output.blueprint,
            evidence=evidence,
            output_dir=output_path,
            template_path=template_path,
            file_stem=file_stem,
        )
        validation_report_path = output_path / f"{file_stem}.validation.json"
        validation_report_path.write_text(render_result.model_dump_json(indent=2), encoding="utf-8")

        manifest = FullPipelineManifest(
            status=render_result.validation_report.status,
            data_report=data_report,
            feasibility_plan=feasibility_plan,
            verified_narrative=verified_narrative,
            blueprint_output=blueprint_output,
            pptx_path=render_result.manifest.pptx_path,
            xlsx_path=render_result.manifest.xlsx_path,
            validation_report_path=str(validation_report_path),
        )
        manifest_path = output_path / f"{file_stem}.pipeline.json"
        manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
        _log("Pipeline complete")
        return manifest

    def _run_blueprint_stage(
        self,
        *,
        prompt: str,
        data_report: DataIntelligenceReport,
        feasibility_plan: AnalysisFeasibilityPlan,
        verified_narrative: VerifiedAnalysisNarrative,
        evidence: EvidencePacketV2,
        template_profile: dict[str, Any],
    ) -> BlueprintStageOutput:
        validation_error = ""
        for _ in range(2):
            output = self._run_stage(
                "presentation-design",
                BlueprintStageOutput,
                BLUEPRINT_STAGE_PROMPT,
                {
                    "user_prompt": prompt,
                    "data_report": data_report.model_dump(mode="json"),
                    "feasibility_plan": feasibility_plan.model_dump(mode="json"),
                    "verified_narrative": verified_narrative.model_dump(mode="json"),
                    "evidence_catalog": _compact_evidence_catalog(evidence),
                    "template_profile": _compact_template_profile(template_profile),
                    "previous_validation_error": validation_error,
                },
            )
            try:
                _validate_blueprint_refs(output.blueprint, evidence)
                return output
            except ValueError as error:
                validation_error = str(error)
        raise ValueError(f"presentation blueprint remained invalid: {validation_error}")

    def _run_evidence_stage(
        self,
        *,
        prompt: str,
        data_report: DataIntelligenceReport,
        feasibility_plan: AnalysisFeasibilityPlan,
        profile_payload: list[dict[str, Any]],
    ) -> EvidencePacketV2:
        validation_error = ""
        for _ in range(2):
            evidence = self._run_stage(
                "evidence-discovery",
                EvidencePacketV2,
                EVIDENCE_DISCOVERY_STAGE_PROMPT,
                {
                    "user_prompt": prompt,
                    "data_report": data_report.model_dump(mode="json"),
                    "feasibility_plan": feasibility_plan.model_dump(mode="json"),
                    "workbook_profiles": profile_payload,
                    "previous_validation_error": validation_error,
                },
            )
            try:
                _validate_evidence_packet(evidence)
                return evidence
            except ValueError as error:
                validation_error = str(error)
        raise ValueError(f"agent evidence remained invalid: {validation_error}")

    def _run_stage(
        self,
        stage_name: str,
        output_model: type[StageOutput],
        system_prompt: str,
        context: dict[str, Any],
    ) -> StageOutput:
        _log(f"Starting agent stage: {stage_name}")
        agent = Agent(
            model=self._model,
            tools=[],
            system_prompt=system_prompt,
            callback_handler=None,
            load_tools_from_directory=False,
            name=f"Universal Presentation {stage_name}",
        )
        result = agent(
            json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str),
            structured_output_model=output_model,
        )
        if result.structured_output is None:
            raise RuntimeError(f"{stage_name} did not return structured output")
        output = output_model.model_validate(result.structured_output)
        _log(f"Finished agent stage: {stage_name}")
        return output

    @staticmethod
    def _ensure_not_blocked(status: str, stage: str) -> None:
        if status == "blocked":
            raise RuntimeError(f"{stage} blocked the pipeline")


def _validate_blueprint_refs(blueprint: PresentationBlueprint, evidence: EvidencePacketV2) -> None:
    metric_ids = {item.metric_id for item in evidence.metrics}
    chart_ids = {item.chart_id for item in evidence.charts}
    claim_ids = {item.claim_id for item in evidence.claims}
    table_ids = {item.table_id for item in evidence.tables}
    for slide in blueprint.slides:
        for element in slide.elements:
            if element.metric_ref and element.metric_ref not in metric_ids:
                raise ValueError(f"unknown metric_ref in blueprint: {element.metric_ref}")
            if element.chart_ref and element.chart_ref not in chart_ids:
                raise ValueError(f"unknown chart_ref in blueprint: {element.chart_ref}")
            if element.claim_ref and element.claim_ref not in claim_ids:
                raise ValueError(f"unknown claim_ref in blueprint: {element.claim_ref}")
            if element.table_ref and element.table_ref not in table_ids:
                raise ValueError(f"unknown table_ref in blueprint: {element.table_ref}")


def _validate_evidence_packet(evidence: EvidencePacketV2) -> None:
    if not evidence.metrics:
        raise ValueError("evidence packet must include at least one metric")
    if not evidence.charts:
        raise ValueError("evidence packet must include at least one chart")
    if not evidence.claims:
        raise ValueError("evidence packet must include at least one claim")
    if not evidence.tables:
        raise ValueError("evidence packet must include at least one table")
    metric_ids = {item.metric_id for item in evidence.metrics}
    chart_ids = {item.chart_id for item in evidence.charts}
    table_ids = {item.table_id for item in evidence.tables}
    for chart in evidence.charts:
        if not chart.metric_refs:
            raise ValueError(f"chart must reference supporting metrics: {chart.chart_id}")
        unknown_metrics = [metric_ref for metric_ref in chart.metric_refs if metric_ref not in metric_ids]
        if unknown_metrics:
            raise ValueError(f"chart references unknown metrics: {chart.chart_id}: {', '.join(unknown_metrics)}")
    for claim in evidence.claims:
        unknown_metrics = [metric_ref for metric_ref in claim.metric_refs if metric_ref not in metric_ids]
        unknown_charts = [chart_ref for chart_ref in claim.chart_refs if chart_ref not in chart_ids]
        if unknown_metrics or unknown_charts:
            raise ValueError(f"claim references unknown evidence: {claim.claim_id}")
    for table in evidence.tables:
        if table.table_id not in table_ids:
            raise ValueError(f"invalid table id: {table.table_id}")


def _compact_evidence_catalog(evidence: EvidencePacketV2) -> dict[str, Any]:
    return {
        "metrics": [
            {
                "metric_id": metric.metric_id,
                "label": metric.label,
                "display_format": metric.display_format,
                "unit": metric.unit,
            }
            for metric in evidence.metrics
        ],
        "charts": [
            {
                "chart_id": chart.chart_id,
                "title": chart.title,
                "chart_type": chart.chart_type,
                "metric_refs": chart.metric_refs,
            }
            for chart in evidence.charts
        ],
        "claims": [
            {
                "claim_id": claim.claim_id,
                "text": claim.text,
                "metric_refs": claim.metric_refs,
                "chart_refs": claim.chart_refs,
            }
            for claim in evidence.claims
        ],
        "tables": [
            {
                "table_id": table.table_id,
                "title": table.title,
                "headers": table.headers,
            }
            for table in evidence.tables
        ],
    }


def _compact_template_profile(template_profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": template_profile.get("source", "default"),
        "slide_width": template_profile.get("slide_width", 13.333),
        "slide_height": template_profile.get("slide_height", 7.5),
        "layouts": list(template_profile.get("layouts", []))[:6],
        "theme_fonts": list(template_profile.get("theme_fonts", []))[:4],
        "theme_colors": list(template_profile.get("theme_colors", []))[:8],
        "fixed_regions": list(template_profile.get("fixed_regions", []))[:4],
        "sample_slides": list(template_profile.get("sample_slides", []))[:12],
    }


def load_env_file(path: str | Path) -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def build_bedrock_model() -> BedrockModel:
    region = os.environ.get("AWS_REGION", "us-east-1")
    model_id = os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    max_tokens = int(os.environ.get("BEDROCK_MAX_TOKENS", "9000"))
    return BedrockModel(
        model_id=model_id,
        region_name=region,
        temperature=0.1,
        max_tokens=max_tokens,
        boto_client_config=Config(connect_timeout=10, read_timeout=600, retries={"max_attempts": 2, "mode": "standard"}),
    )


def _log(message: str) -> None:
    print(f"[universal-presentation] {message}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the full real-agent universal data-to-presentation pipeline.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--template")
    parser.add_argument("--output-dir", default="/tmp/universal-agent-presentation")
    parser.add_argument("--file-stem", default="universal-agent-presentation")
    parser.add_argument("--env-file", default=".env.aws")
    arguments = parser.parse_args()
    load_env_file(arguments.env_file)
    manifest = UniversalPresentationPipeline(build_bedrock_model()).run(
        prompt=arguments.prompt,
        data_paths=[Path(path) for path in arguments.data],
        template_path=Path(arguments.template) if arguments.template else None,
        output_dir=Path(arguments.output_dir),
        file_stem=arguments.file_stem,
    )
    print(json.dumps({
        "status": manifest.status,
        "pptxPath": manifest.pptx_path,
        "xlsxPath": manifest.xlsx_path,
        "validationReportPath": manifest.validation_report_path,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
