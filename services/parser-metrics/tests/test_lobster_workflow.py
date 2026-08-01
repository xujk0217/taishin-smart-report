"""Functional tests for the local synthetic Lobster workflow."""
from pathlib import Path
import zipfile

import pytest

from src.lobster_workflow import LocalLobsterWorkflow, read_json

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE_XLSX = REPO_ROOT / "packages" / "test-fixtures" / "fixtures" / "reference-data.xlsx"
TSX = REPO_ROOT / "services" / "render-pptx" / "node_modules" / ".bin" / "tsx"


@pytest.fixture
def reference_file() -> Path:
    if not REFERENCE_XLSX.exists():
        pytest.skip("Synthetic reference fixture is unavailable")
    return REFERENCE_XLSX


def test_start_pauses_before_metric_computation(reference_file: Path, tmp_path: Path) -> None:
    state = LocalLobsterWorkflow(tmp_path).start(reference_file, "Analyze synthetic trends")

    assert state["currentStage"] == "formula-approval"
    assert state["status"] == "awaiting_formula_approval"
    assert state["contextVersion"] == 3
    assert (tmp_path / "work" / "formula-plan.json").exists()
    assert not (tmp_path / "work" / "metrics.json").exists()

    formula_gate = read_json(tmp_path / "gates" / "002-formula-plan.json")
    assert formula_gate["outcome"] == "NEEDS_USER_DECISION"
    assert formula_gate["signature"]["state"] == "DEFERRED_LOCAL_ONLY"


def test_rejects_non_fixture_input(tmp_path: Path) -> None:
    unapproved = tmp_path / "unapproved.xlsx"
    unapproved.write_bytes(b"not-a-workbook")

    with pytest.raises(ValueError, match="only the approved synthetic"):
        LocalLobsterWorkflow(tmp_path / "output").start(unapproved, "Do not process")


def test_run_all_produces_gated_native_pptx(reference_file: Path, tmp_path: Path) -> None:
    if not TSX.exists():
        pytest.skip("render-pptx dependencies are not installed")

    state = LocalLobsterWorkflow(tmp_path).run_all(reference_file, "Analyze synthetic trends")

    assert state["currentStage"] == "completed"
    assert state["status"] == "completed"
    assert state["contextVersion"] == 10
    assert state["attempts"]["insight"] == 1

    artifact = tmp_path / "artifacts" / "output.pptx"
    inspection = read_json(tmp_path / "work" / "artifact-inspection.json")
    claims = read_json(tmp_path / "work" / "claim-registry.json")
    manifest = read_json(tmp_path / "artifacts" / "artifact-manifest.json")

    assert artifact.stat().st_size > 10_000
    assert inspection["passed"] is True
    assert inspection["chartCount"] >= 1
    assert claims["mode"] == "deterministic-no-ai"
    assert manifest["delivery"] == "local-only"

    with zipfile.ZipFile(artifact) as archive:
        names = archive.namelist()
        assert "[Content_Types].xml" in names
        assert any(name.startswith("ppt/charts/chart") for name in names)

    gate_results = [read_json(path) for path in sorted((tmp_path / "gates").glob("*.json"))]
    assert len(gate_results) == 10
    assert all(result["outcome"] in {"PASS", "NEEDS_USER_DECISION"} for result in gate_results)
