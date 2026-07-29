"""Tests for normalizer module."""
import pytest
from src.normalizer import normalize_period, normalize_number, normalize_entity


class TestNormalizePeriod:
    """Tests for period normalization."""

    def test_five_digit_format(self):
        assert normalize_period("11401") == "11401"
        assert normalize_period("11412") == "11412"

    def test_slash_format(self):
        assert normalize_period("114/01") == "11401"
        assert normalize_period("114/12") == "11412"

    def test_dash_format(self):
        assert normalize_period("114-01") == "11401"
        assert normalize_period("114-6") == "11406"

    def test_chinese_format(self):
        assert normalize_period("114年1月") == "11401"
        assert normalize_period("114年12月") == "11412"

    def test_western_year_format(self):
        assert normalize_period("2025/01") == "11401"
        assert normalize_period("2025/12") == "11412"

    def test_invalid_formats(self):
        assert normalize_period("abc") is None
        assert normalize_period("") is None
        assert normalize_period("99913") is None  # Year too low
        assert normalize_period("11413") is None  # Month > 12


class TestNormalizeNumber:
    """Tests for number normalization."""

    def test_integer(self):
        val, dtype = normalize_number(1234)
        assert val == 1234.0
        assert dtype == "amount"

    def test_float(self):
        val, dtype = normalize_number(10.61)
        assert val == 10.61
        assert dtype == "amount"

    def test_decimal_as_percentage(self):
        """Values between 0 and 1 are treated as percentages."""
        val, dtype = normalize_number(0.1061)
        assert abs(val - 10.61) < 0.001
        assert dtype == "percentage"

    def test_percentage_string(self):
        val, dtype = normalize_number("10.61%")
        assert val == 10.61
        assert dtype == "percentage"

    def test_comma_separated(self):
        val, dtype = normalize_number("1,234,567")
        assert val == 1234567.0
        assert dtype == "amount"

    def test_none_value(self):
        val, dtype = normalize_number(None)
        assert val is None
        assert dtype == "text"

    def test_text_value(self):
        val, dtype = normalize_number("台新銀行")
        assert val is None
        assert dtype == "text"


class TestNormalizeEntity:
    """Tests for entity name normalization."""

    def test_standard_names(self):
        assert normalize_entity("台新") == "台新銀行"
        assert normalize_entity("中信") == "中國信託"
        assert normalize_entity("國泰世華") == "國泰世華"

    def test_full_names(self):
        assert normalize_entity("台新國際商業銀行") == "台新銀行"
        assert normalize_entity("中國信託商業銀行") == "中國信託"

    def test_total_names(self):
        assert normalize_entity("合計") == "全體銀行"
        assert normalize_entity("總計") == "全體銀行"

    def test_unknown_passes_through(self):
        assert normalize_entity("未知銀行") == "未知銀行"

    def test_whitespace_handling(self):
        assert normalize_entity("  台新  ") == "台新銀行"
