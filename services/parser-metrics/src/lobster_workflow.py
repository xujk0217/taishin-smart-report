"""Local functional Lobster workflow using only the approved synthetic fixture.

This module proves stage separation, persistence, approvals, deterministic compute,
rendering, and independent gate decisions before AWS Step Functions/ECS enablement.
It intentionally does not upload data, call AI providers, or deploy resources.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from .evidence_builder import EvidencePacketBuilder, build_chart_data_specs
from .formula_plan_builder import build_formula_plan
from .metric_engine import MetricEngine
from .sheet_reader import read_workbook
from .source_mapper import build_source_refs

WORKFLOW_VERSION = "local-functional-v1"
MAX_ATTEMPTS = 3


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class StageOutput:
    next_stage: str
    gate_outcome: str
    outputs: list[Path]
    findings: list[dict[str, Any]]


class WorkflowStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        for name in ("context", "receipts", "manifests", "gates", "work", "artifacts"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    @property
    def state_path(self) -> Path:
        return self.root / "workflow-state.json"

    def load_state(self) -> dict[str, Any]:
        if not self.state_path.exists():
            raise RuntimeError("Workflow has not been started")
        return read_json(self.state_path)

    def save_state(self, state: dict[str, Any]) -> None:
        write_json(self.state_path, state)
        write_json(self.root / "context" / f"context-v{state['contextVersion']:03d}.json", state)

    def record_stage(
        self,
        stage: str,
        attempt: int,
        before_version: int,
        output: StageOutput,
    ) -> None:
        output_refs = [
            {
                "path": str(path.relative_to(self.root)),
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
            for path in output.outputs
        ]
        receipt_id = str(uuid4())
        manifest_id = str(uuid4())
        receipt = {
            "receiptId": receipt_id,
            "workflowVersion": WORKFLOW_VERSION,
            "stage": stage,
            "attempt": attempt,
            "status": "succeeded" if output.gate_outcome in {"PASS", "NEEDS_USER_DECISION"} else "failed",
            "outputRefs": output_refs,
            "completedAt": utc_now(),
        }
        manifest = {
            "manifestId": manifest_id,
            "workflowVersion": WORKFLOW_VERSION,
            "stage": stage,
            "attempt": attempt,
            "contextVersionBefore": before_version,
            "contextVersionAfter": before_version + 1,
            "toolReceiptIds": [receipt_id],
            "proposedTransition": output.next_stage,
            "outputRefs": output_refs,
            "createdAt": utc_now(),
        }
        gate = LocalStageGate.evaluate(stage, output, manifest)
        write_json(self.root / "receipts" / f"{before_version:03d}-{stage}.json", receipt)
        write_json(self.root / "manifests" / f"{before_version:03d}-{stage}.json", manifest)
        write_json(self.root / "gates" / f"{before_version:03d}-{stage}.json", gate)
        if gate["outcome"] not in {"PASS", "NEEDS_USER_DECISION"}:
            raise RuntimeError(f"Stage {stage} blocked: {gate['findings']}")


class LocalStageGate:
    """Independent functional gate; cryptographic signing is intentionally deferred."""

    @staticmethod
    def evaluate(stage: str, output: StageOutput, manifest: dict[str, Any]) -> dict[str, Any]:
        missing_outputs = [ref["path"] for ref in manifest["outputRefs"] if ref["sizeBytes"] <= 0]
        findings = list(output.findings)
        if missing_outputs:
            findings.append({"code": "EMPTY_STAGE_OUTPUT", "severity": "blocking", "paths": missing_outputs})
        outcome = output.gate_outcome
        if any(finding.get("severity") == "blocking" for finding in findings):
            outcome = "BLOCKED"
        return {
            "gateResultId": str(uuid4()),
            "stage": stage,
            "manifestId": manifest["manifestId"],
            "outcome": outcome,
            "proposedTransition": output.next_stage,
            "findings": findings,
            "verifiedAt": utc_now(),
            "signature": {
                "state": "DEFERRED_LOCAL_ONLY",
                "reason": "KMS signing is not enabled for the local functional slice",
            },
        }


class LocalLobsterWorkflow:
    def __init__(self, output_dir: Path):
        self.store = WorkflowStore(output_dir)
        self.repo_root = Path(__file__).resolve().parents[3]
        self.tools: dict[str, Callable[[dict[str, Any]], StageOutput]] = {
            "permission-intake": self._permission_intake,
            "parse-normalize": self._parse_normalize,
            "formula-plan": self._formula_plan,
            "formula-approval": self._formula_approval,
            "compute-freeze": self._compute_freeze,
            "insight": self._insight,
            "blueprint": self._blueprint,
            "render-inspect": self._render_inspect,
            "final-approval": self._final_approval,
            "publish": self._publish,
        }

    def start(self, excel_path: Path, user_request: str) -> dict[str, Any]:
        if self.store.state_path.exists():
            raise RuntimeError("Workflow already exists; use a new output directory")
        fixture_root = (self.repo_root / "packages" / "test-fixtures" / "fixtures").resolve()
        source = excel_path.resolve()
        if source.parent != fixture_root or source.name != "reference-data.xlsx":
            raise ValueError("Local functional workflow accepts only the approved synthetic reference-data.xlsx fixture")
        state = {
            "workflowVersion": WORKFLOW_VERSION,
            "jobId": f"local-{uuid4()}",
            "contextVersion": 0,
            "currentStage": "permission-intake",
            "status": "running",
            "attempts": {},
            "sourcePath": str(source),
            "userRequest": user_request,
            "createdAt": utc_now(),
            "updatedAt": utc_now(),
        }
        self.store.save_state(state)
        return self._run_until_wait(state)

    def approve_formula(self) -> dict[str, Any]:
        state = self.store.load_state()
        if state["currentStage"] != "formula-approval" or state["status"] != "awaiting_formula_approval":
            raise RuntimeError("Workflow is not waiting for formula approval")
        approval = {
            "type": "formula-approval",
            "decision": "approved",
            "jobId": state["jobId"],
            "decidedAt": utc_now(),
            "mode": "local-synthetic",
        }
        write_json(self.store.root / "work" / "formula-approval.json", approval)
        state["status"] = "running"
        self.store.save_state(state)
        return self._run_until_wait(state)

    def approve_final(self) -> dict[str, Any]:
        state = self.store.load_state()
        if state["currentStage"] != "final-approval" or state["status"] != "awaiting_final_approval":
            raise RuntimeError("Workflow is not waiting for final approval")
        approval = {
            "type": "final-approval",
            "decision": "approved",
            "jobId": state["jobId"],
            "artifactSha256": sha256_file(self.store.root / "artifacts" / "output.pptx"),
            "decidedAt": utc_now(),
            "mode": "local-synthetic",
        }
        write_json(self.store.root / "work" / "final-approval.json", approval)
        state["status"] = "running"
        self.store.save_state(state)
        return self._run_until_wait(state)

    def run_all(self, excel_path: Path, user_request: str) -> dict[str, Any]:
        state = self.start(excel_path, user_request)
        if state["status"] != "awaiting_formula_approval":
            raise RuntimeError("Expected formula approval wait")
        state = self.approve_formula()
        if state["status"] != "awaiting_final_approval":
            raise RuntimeError("Expected final approval wait")
        return self.approve_final()

    def _run_until_wait(self, state: dict[str, Any]) -> dict[str, Any]:
        while state["status"] == "running" and state["currentStage"] != "completed":
            stage = state["currentStage"]
            tool = self.tools.get(stage)
            if tool is None:
                raise RuntimeError(f"No registered tool for stage {stage}")
            attempt = int(state["attempts"].get(stage, 0)) + 1
            if attempt > MAX_ATTEMPTS:
                raise RuntimeError(f"Maximum attempts exceeded for stage {stage}")
            state["attempts"][stage] = attempt
            before_version = state["contextVersion"]
            output = tool(state)
            self.store.record_stage(stage, attempt, before_version, output)
            state["contextVersion"] = before_version + 1
            state["currentStage"] = output.next_stage
            state["updatedAt"] = utc_now()
            if output.gate_outcome == "NEEDS_USER_DECISION":
                state["status"] = "awaiting_formula_approval" if output.next_stage == "formula-approval" else "awaiting_final_approval"
            elif output.next_stage == "completed":
                state["status"] = "completed"
            self.store.save_state(state)
        return state

    def _permission_intake(self, state: dict[str, Any]) -> StageOutput:
        source = Path(state["sourcePath"])
        manifest = {
            "jobId": state["jobId"],
            "kind": "source",
            "fileName": source.name,
            "sizeBytes": source.stat().st_size,
            "sha256": sha256_file(source),
            "classification": "synthetic-test-fixture",
        }
        path = self.store.root / "work" / "file-manifest.json"
        write_json(path, manifest)
        return StageOutput("parse-normalize", "PASS", [path], [])

    def _parse_normalize(self, state: dict[str, Any]) -> StageOutput:
        source = state["sourcePath"]
        profile = read_workbook(source, state["jobId"])
        source_refs = build_source_refs(source, profile)
        findings: list[dict[str, Any]] = []
        if not profile.get("sheets"):
            findings.append({"code": "WORKBOOK_NO_SHEETS", "severity": "blocking"})
        if not profile.get("detectedPeriods"):
            findings.append({"code": "NO_PERIODS_DETECTED", "severity": "blocking"})
        if not source_refs:
            findings.append({"code": "NO_SOURCE_REFS", "severity": "blocking"})
        profile_path = self.store.root / "work" / "workbook-profile.json"
        refs_path = self.store.root / "work" / "source-refs.json"
        validation_path = self.store.root / "work" / "workbook-validation.json"
        write_json(profile_path, profile)
        write_json(refs_path, source_refs)
        write_json(validation_path, {"passed": not findings, "findings": findings})
        return StageOutput("formula-plan", "PASS", [profile_path, refs_path, validation_path], findings)

    def _formula_plan(self, state: dict[str, Any]) -> StageOutput:
        profile = read_json(self.store.root / "work" / "workbook-profile.json")
        plan = build_formula_plan(profile, state["userRequest"], state["jobId"])
        path = self.store.root / "work" / "formula-plan.json"
        write_json(path, plan)
        findings = [] if plan.get("formulas") else [{"code": "NO_SUPPORTED_FORMULAS", "severity": "blocking"}]
        return StageOutput("formula-approval", "NEEDS_USER_DECISION", [path], findings)

    def _formula_approval(self, state: dict[str, Any]) -> StageOutput:
        approval_path = self.store.root / "work" / "formula-approval.json"
        if not approval_path.exists() or read_json(approval_path).get("decision") != "approved":
            return StageOutput("formula-approval", "BLOCKED", [], [{"code": "FORMULA_APPROVAL_REQUIRED", "severity": "blocking"}])
        plan_path = self.store.root / "work" / "formula-plan.json"
        plan = read_json(plan_path)
        plan["status"] = "approved"
        write_json(plan_path, plan)
        return StageOutput("compute-freeze", "PASS", [plan_path, approval_path], [])

    def _compute_freeze(self, state: dict[str, Any]) -> StageOutput:
        profile = read_json(self.store.root / "work" / "workbook-profile.json")
        source_refs = read_json(self.store.root / "work" / "source-refs.json")
        plan = read_json(self.store.root / "work" / "formula-plan.json")
        if plan.get("status") != "approved":
            return StageOutput("compute-freeze", "BLOCKED", [], [{"code": "FORMULA_PLAN_NOT_APPROVED", "severity": "blocking"}])
        metrics = MetricEngine(source_refs, plan).compute_all()
        chart_specs = build_chart_data_specs(metrics)
        unsupported = [
            {
                "metricName": item["name"],
                "reason": item["reason"],
                "requiredPeriods": item.get("wouldRequire", []),
                "availablePeriods": profile.get("detectedPeriods", []),
            }
            for item in plan.get("unsupported", [])
        ]
        builder = EvidencePacketBuilder(
            job_id=state["jobId"],
            formula_plan_id=plan["planId"],
            workbook_info={"localPath": state["sourcePath"], "sha256": profile["sourceFileHash"]},
        )
        builder.add_source_refs(source_refs)
        builder.add_metrics(metrics)
        builder.add_chart_data_specs(chart_specs)
        builder.add_unsupported_requests(unsupported)
        packet = builder.freeze()
        metrics_path = self.store.root / "work" / "metrics.json"
        charts_path = self.store.root / "work" / "chart-data-specs.json"
        packet_path = self.store.root / "work" / "evidence-packet.json"
        write_json(metrics_path, metrics)
        write_json(charts_path, chart_specs)
        write_json(packet_path, packet)
        findings = [] if packet.get("frozen") and packet.get("canonicalSha256") else [{"code": "EVIDENCE_NOT_FROZEN", "severity": "blocking"}]
        return StageOutput("insight", "PASS", [metrics_path, charts_path, packet_path], findings)

    def _insight(self, state: dict[str, Any]) -> StageOutput:
        packet = read_json(self.store.root / "work" / "evidence-packet.json")
        findings: list[dict[str, Any]] = []
        if not packet.get("frozen"):
            findings.append({"code": "INSIGHT_REQUIRES_FROZEN_EVIDENCE", "severity": "blocking"})
        registry = {
            "packetId": packet.get("packetId"),
            "accepted": [],
            "rejected": [],
            "conflicts": [],
            "mode": "deterministic-no-ai",
            "note": "Bedrock insight generation is deferred; stage topology remains explicit.",
        }
        path = self.store.root / "work" / "claim-registry.json"
        write_json(path, registry)
        return StageOutput("blueprint", "PASS", [path], findings)

    def _blueprint(self, state: dict[str, Any]) -> StageOutput:
        charts = read_json(self.store.root / "work" / "chart-data-specs.json")
        selected = charts[:4]
        slides: list[dict[str, Any]] = [
            {"slideIndex": 0, "layout": "cover", "masterId": "cover", "content": {"title": "Synthetic Credit Card Report", "subtitle": "Local functional Lobster workflow"}},
            {"slideIndex": 1, "layout": "section", "masterId": "section", "content": {"title": "Deterministic Metrics"}},
        ]
        for index, chart in enumerate(selected, start=2):
            slides.append({
                "slideIndex": index,
                "layout": "chart",
                "masterId": "chart",
                "content": {
                    "title": f"{chart['series'][0]['name'] if chart.get('series') else 'Metric'} trend",
                    "chart": {"type": "line", "chartDataSpecId": chart["chartDataSpecId"], "xAxis": {"label": "Period"}, "yAxis": {"label": "Value"}},
                },
            })
        slides.append({"slideIndex": len(slides), "layout": "conclusion", "masterId": "conclusion", "content": {"title": "Evidence Complete", "body": "Generated only from the approved synthetic fixture."}})
        spec = {"specId": f"spec-{state['jobId']}-v1", "jobId": state["jobId"], "version": 1, "status": "validated", "slides": slides}
        path = self.store.root / "work" / "slide-deck-spec.json"
        write_json(path, spec)
        return StageOutput("render-inspect", "PASS", [path], [])

    def _render_inspect(self, state: dict[str, Any]) -> StageOutput:
        request_path = self.store.root / "work" / "render-request.json"
        report_path = self.store.root / "work" / "render-report.json"
        artifact_path = self.store.root / "artifacts" / "output.pptx"
        request = {
            "slideDeckSpecPath": str(self.store.root / "work" / "slide-deck-spec.json"),
            "chartDataSpecsPath": str(self.store.root / "work" / "chart-data-specs.json"),
            "outputPath": str(artifact_path),
            "reportPath": str(report_path),
        }
        write_json(request_path, request)
        tsx = self.repo_root / "services" / "render-pptx" / "node_modules" / ".bin" / "tsx"
        worker = self.repo_root / "services" / "render-pptx" / "src" / "worker-cli.ts"
        subprocess.run([str(tsx), str(worker), str(request_path)], cwd=self.repo_root / "services" / "render-pptx", check=True)
        report = read_json(report_path)
        findings: list[dict[str, Any]] = []
        if artifact_path.stat().st_size < 10_000:
            findings.append({"code": "PPTX_TOO_SMALL", "severity": "blocking"})
        try:
            with zipfile.ZipFile(artifact_path) as archive:
                names = set(archive.namelist())
                slide_count = len([name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")])
                chart_count = len([name for name in names if name.startswith("ppt/charts/chart") and name.endswith(".xml")])
                if "[Content_Types].xml" not in names:
                    findings.append({"code": "PPTX_CONTENT_TYPES_MISSING", "severity": "blocking"})
                if slide_count != report["slideCount"]:
                    findings.append({"code": "PPTX_SLIDE_COUNT_MISMATCH", "severity": "blocking"})
                if chart_count < report["chartCount"]:
                    findings.append({"code": "PPTX_NATIVE_CHART_MISSING", "severity": "blocking"})
        except zipfile.BadZipFile:
            findings.append({"code": "PPTX_NOT_OPENABLE", "severity": "blocking"})
        inspection_path = self.store.root / "work" / "artifact-inspection.json"
        write_json(inspection_path, {"passed": not findings, "findings": findings, "artifactSha256": sha256_file(artifact_path), **report})
        return StageOutput("final-approval", "NEEDS_USER_DECISION", [artifact_path, report_path, inspection_path], findings)

    def _final_approval(self, state: dict[str, Any]) -> StageOutput:
        approval_path = self.store.root / "work" / "final-approval.json"
        if not approval_path.exists() or read_json(approval_path).get("decision") != "approved":
            return StageOutput("final-approval", "BLOCKED", [], [{"code": "FINAL_APPROVAL_REQUIRED", "severity": "blocking"}])
        return StageOutput("publish", "PASS", [approval_path], [])

    def _publish(self, state: dict[str, Any]) -> StageOutput:
        artifact = self.store.root / "artifacts" / "output.pptx"
        published = {
            "jobId": state["jobId"],
            "artifact": "artifacts/output.pptx",
            "artifactSha256": sha256_file(artifact),
            "delivery": "local-only",
            "completedAt": utc_now(),
        }
        path = self.store.root / "artifacts" / "artifact-manifest.json"
        write_json(path, published)
        return StageOutput("completed", "PASS", [path, artifact], [])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local synthetic Lobster workflow")
    subparsers = parser.add_subparsers(dest="command", required=True)
    start = subparsers.add_parser("start")
    start.add_argument("excel_path", type=Path)
    start.add_argument("output_dir", type=Path)
    start.add_argument("--request", default="Analyze the synthetic credit-card trends")
    approve_formula = subparsers.add_parser("approve-formula")
    approve_formula.add_argument("output_dir", type=Path)
    approve_final = subparsers.add_parser("approve-final")
    approve_final.add_argument("output_dir", type=Path)
    run_all = subparsers.add_parser("run-all")
    run_all.add_argument("excel_path", type=Path)
    run_all.add_argument("output_dir", type=Path)
    run_all.add_argument("--request", default="Analyze the synthetic credit-card trends")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    workflow = LocalLobsterWorkflow(args.output_dir)
    if args.command == "start":
        state = workflow.start(args.excel_path, args.request)
    elif args.command == "approve-formula":
        state = workflow.approve_formula()
    elif args.command == "approve-final":
        state = workflow.approve_final()
    else:
        state = workflow.run_all(args.excel_path, args.request)
    print(json.dumps({"jobId": state["jobId"], "stage": state["currentStage"], "status": state["status"], "contextVersion": state["contextVersion"]}, indent=2))


if __name__ == "__main__":
    main()
