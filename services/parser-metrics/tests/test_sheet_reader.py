"""Tests for sheet_reader module."""
import os
from pathlib import Path

import pytest

from src.sheet_reader import read_workbook

FIXTURE_DIR = Path(__file__).parent.parent.parent.parent / "packages" / "test-fixtures" / "fixtures"
REFERENCE_XLSX = FIXTURE_DIR / "reference-data.xlsx"


@pytest.fixture
def reference_file():
    """Path to the reference Excel fixture."""
    if not REFERENCE_XLSX.exists():
        pytest.skip("Reference data fixture not available")
    return str(REFERENCE_XLSX)


class TestSheetReader:
    """Tests for read_workbook function."""

    def test_reads_workbook_successfully(self, reference_file):
        """Should read the reference XLSX and produce a valid WorkbookProfile."""
        profile = read_workbook(reference_file, "test-job-001")
        
        assert profile["jobId"] == "test-job-001"
        assert profile["profileId"] == "profile-test-job-001"
        assert len(profile["sheets"]) > 0
        assert profile["sourceFileHash"]  # Should have SHA-256
        assert len(profile["sourceFileHash"]) == 64  # SHA-256 hex length

    def test_detects_sheet_structure(self, reference_file):
        """Should detect headers, data ranges, and columns."""
        profile = read_workbook(reference_file, "test-job-001")
        
        for sheet in profile["sheets"]:
            assert "sheetName" in sheet
            assert "headerRow" in sheet
            assert "dataStartRow" in sheet
            assert "dataEndRow" in sheet
            assert "columns" in sheet
            assert sheet["dataStartRow"] > sheet["headerRow"]

    def test_detects_periods(self, reference_file):
        """Should detect period columns in YYMM format."""
        profile = read_workbook(reference_file, "test-job-001")
        
        # The reference data should have some periods detected
        periods = profile["detectedPeriods"]
        assert len(periods) > 0
        # All periods should be 5-digit strings
        for p in periods:
            assert len(p) == 5
            assert p.isdigit()

    def test_rejects_nonexistent_file(self):
        """Should raise FileNotFoundError for missing files."""
        with pytest.raises(FileNotFoundError):
            read_workbook("/nonexistent/file.xlsx", "test")

    def test_rejects_unsupported_format(self, tmp_path):
        """Should raise ValueError for non-xlsx files."""
        csv_file = tmp_path / "data.csv"
        csv_file.write_text("a,b,c")
        with pytest.raises(ValueError, match="Unsupported"):
            read_workbook(str(csv_file), "test")
