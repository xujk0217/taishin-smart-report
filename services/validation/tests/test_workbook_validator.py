"""Tests for workbook_validator module."""
import pytest
from src.workbook_validator import validate_workbook


class TestWorkbookValidator:
    def test_valid_profile_passes(self):
        profile = {
            "sheets": [
                {
                    "sheetName": "簽帳金額",
                    "headerRow": 1,
                    "dataStartRow": 2,
                    "dataEndRow": 17,
                    "columns": ["銀行", "11401", "11402"],
                    "mergedCells": [],
                    "dataQuality": {"nullCount": 0, "formatIssues": []},
                }
            ],
            "detectedPeriods": ["11401", "11402"],
            "detectedEntities": ["台新銀行"],
        }
        result = validate_workbook(profile)
        assert result["passed"] is True
        assert result["blockingCount"] == 0

    def test_empty_sheets_blocks(self):
        profile = {"sheets": [], "detectedPeriods": [], "detectedEntities": []}
        result = validate_workbook(profile)
        assert result["passed"] is False
        assert result["blockingCount"] >= 1

    def test_no_periods_blocks(self):
        profile = {
            "sheets": [
                {
                    "sheetName": "test",
                    "headerRow": 1,
                    "dataStartRow": 2,
                    "dataEndRow": 5,
                    "columns": ["A", "B"],
                    "mergedCells": [],
                    "dataQuality": {"nullCount": 0, "formatIssues": []},
                }
            ],
            "detectedPeriods": [],
            "detectedEntities": ["台新"],
        }
        result = validate_workbook(profile)
        assert result["passed"] is False

    def test_insufficient_columns_blocks(self):
        profile = {
            "sheets": [
                {
                    "sheetName": "test",
                    "headerRow": 1,
                    "dataStartRow": 2,
                    "dataEndRow": 5,
                    "columns": ["A"],
                    "mergedCells": [],
                    "dataQuality": {"nullCount": 0, "formatIssues": []},
                }
            ],
            "detectedPeriods": ["11401"],
            "detectedEntities": ["台新"],
        }
        result = validate_workbook(profile)
        assert result["passed"] is False
