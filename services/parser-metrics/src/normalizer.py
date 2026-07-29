"""
normalizer.py - Standardizes raw Excel values into consistent formats.
Handles numbers, percentages, dates, periods, units, and entity names.
"""
import re
from typing import Any, Optional


# ─── Period Normalization ─────────────────────────────────────

def normalize_period(raw: str) -> Optional[str]:
    """
    Normalize a period string to YYMM format (5 digits, e.g., 11401 = year 114, month 01).
    
    Handles formats:
    - "11401" (already normalized)
    - "114/01", "114-01", "114.01"
    - "114年1月"
    - "2025/01" -> convert to ROC year
    """
    raw = str(raw).strip()
    
    # Already 5-digit format
    if re.match(r'^\d{5}$', raw):
        year = int(raw[:3])
        month = int(raw[3:])
        if 100 <= year <= 200 and 1 <= month <= 12:
            return raw
    
    # Format: 114/01, 114-01, 114.01
    m = re.match(r'^(\d{3})[/\-.](\d{1,2})$', raw)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 100 <= year <= 200 and 1 <= month <= 12:
            return f"{year}{month:02d}"
    
    # Format: 114年1月 or 114年01月
    m = re.match(r'^(\d{3})年(\d{1,2})月$', raw)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 100 <= year <= 200 and 1 <= month <= 12:
            return f"{year}{month:02d}"
    
    # Format: 2025/01 (Western year -> ROC)
    m = re.match(r'^(\d{4})[/\-.](\d{1,2})$', raw)
    if m:
        western_year, month = int(m.group(1)), int(m.group(2))
        roc_year = western_year - 1911
        if 100 <= roc_year <= 200 and 1 <= month <= 12:
            return f"{roc_year}{month:02d}"
    
    return None


# ─── Number Normalization ─────────────────────────────────────

def normalize_number(raw: Any) -> tuple[Optional[float], str]:
    """
    Normalize a raw value to a float and determine its data type.
    
    Returns:
        (normalized_value, data_type) where data_type is one of:
        "percentage", "amount", "count", "rank"
    """
    if raw is None:
        return None, "text"
    
    if isinstance(raw, (int, float)):
        # If value is between 0 and 1, likely a percentage stored as decimal
        if 0 < abs(raw) < 1:
            return float(raw) * 100, "percentage"
        return float(raw), "amount"
    
    raw_str = str(raw).strip()
    
    # Percentage format: "10.61%" or "10.61%"
    m = re.match(r'^([+-]?\d+\.?\d*)\s*[%％]$', raw_str)
    if m:
        return float(m.group(1)), "percentage"
    
    # Number with commas: "1,234,567"
    if re.match(r'^[+-]?\d{1,3}(,\d{3})*(\.\d+)?$', raw_str):
        return float(raw_str.replace(',', '')), "amount"
    
    # Plain number
    try:
        val = float(raw_str)
        return val, "amount"
    except (ValueError, TypeError):
        pass
    
    return None, "text"


# ─── Entity Name Normalization ────────────────────────────────

# Common bank name mappings for Taiwan credit card issuers
BANK_NAME_MAP: dict[str, str] = {
    "台新": "台新銀行",
    "台新銀行": "台新銀行",
    "台新國際商業銀行": "台新銀行",
    "中信": "中國信託",
    "中國信託": "中國信託",
    "中國信託商業銀行": "中國信託",
    "國泰": "國泰世華",
    "國泰世華": "國泰世華",
    "國泰世華商業銀行": "國泰世華",
    "玉山": "玉山銀行",
    "玉山銀行": "玉山銀行",
    "花旗": "花旗銀行",
    "花旗銀行": "花旗銀行",
    "富邦": "台北富邦",
    "台北富邦": "台北富邦",
    "台北富邦商業銀行": "台北富邦",
    "永豐": "永豐銀行",
    "永豐銀行": "永豐銀行",
    "聯邦": "聯邦銀行",
    "聯邦銀行": "聯邦銀行",
    "第一": "第一銀行",
    "第一銀行": "第一銀行",
    "合庫": "合作金庫",
    "合作金庫": "合作金庫",
    "華南": "華南銀行",
    "華南銀行": "華南銀行",
    "彰銀": "彰化銀行",
    "彰化銀行": "彰化銀行",
    "新光": "新光銀行",
    "新光銀行": "新光銀行",
    "遠東": "遠東銀行",
    "遠東銀行": "遠東銀行",
    "星展": "星展銀行",
    "星展銀行": "星展銀行",
    "匯豐": "匯豐銀行",
    "匯豐銀行": "匯豐銀行",
    "渣打": "渣打銀行",
    "渣打銀行": "渣打銀行",
    "凱基": "凱基銀行",
    "凱基銀行": "凱基銀行",
    "兆豐": "兆豐銀行",
    "兆豐銀行": "兆豐銀行",
    "元大": "元大銀行",
    "元大銀行": "元大銀行",
    "全體": "全體銀行",
    "合計": "全體銀行",
    "總計": "全體銀行",
}


def normalize_entity(raw: str) -> str:
    """Normalize a bank/entity name to canonical form."""
    cleaned = raw.strip()
    return BANK_NAME_MAP.get(cleaned, cleaned)


# ─── Unit Detection ───────────────────────────────────────────

def detect_unit(sheet_name: str, header: str) -> str:
    """Detect the unit based on sheet name and column header context."""
    text = f"{sheet_name} {header}".lower()
    
    if "百萬" in text or "million" in text:
        return "百萬元"
    if "千" in text:
        return "千元"
    if "%" in text or "率" in text or "比" in text or "占" in text:
        return "percent"
    if "張" in text or "卡" in text:
        return "張"
    if "筆" in text:
        return "筆"
    
    return "百萬元"  # Default for credit card statistics
