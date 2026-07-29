"""
numeric_claim_validator.py - Validates claim numbers against EvidencePacket.
Extracts numbers from claim statements and cross-references with MetricRecords.
"""
import re
from typing import Any


def validate_claims(
    claims: list[dict[str, Any]],
    evidence_packet: dict[str, Any],
) -> dict[str, Any]:
    """
    Validate all claims against the EvidencePacket.
    
    Checks:
    1. All evidence IDs exist in packet
    2. Extracted numbers match MetricRecord values
    3. Direction assertions match actual numeric comparisons
    4. Unsupported metrics are not referenced
    
    Returns:
        ValidationResult dict
    """
    findings: list[dict[str, Any]] = []
    finding_counter = 0

    # Build lookup indexes
    metric_index = {m["metricId"]: m for m in evidence_packet.get("metrics", [])}
    unsupported_names = set()
    for u in evidence_packet.get("unsupportedRequests", []):
        name = u.get("metricName") or u.get("name", "")
        if name:
            unsupported_names.add(name)

    for claim in claims:
        claim_id = claim.get("claimId", "unknown")

        # Check 1: All evidenceIds exist
        for eid in claim.get("evidenceIds", []):
            if eid not in metric_index:
                finding_counter += 1
                findings.append(_finding(
                    finding_counter, "EVIDENCE_ID_NOT_FOUND", "blocking",
                    "ValidateClaims",
                    f"Claim '{claim_id}' 引用的 Evidence ID '{eid}' 不存在於 EvidencePacket",
                    details={"claimId": claim_id, "missingEvidenceId": eid},
                ))

        # Check 2: Extracted numbers match metric values
        for num in claim.get("extractedNumbers", []):
            metric_id = num.get("metricId")
            if metric_id not in metric_index:
                finding_counter += 1
                findings.append(_finding(
                    finding_counter, "METRIC_NOT_FOUND", "blocking",
                    "ValidateClaims",
                    f"Claim '{claim_id}' 引用的 Metric '{metric_id}' 不存在",
                    details={"claimId": claim_id, "metricId": metric_id},
                ))
                continue

            metric = metric_index[metric_id]
            expected_value = metric["computedValue"]
            actual_value = num["value"]

            # Check if the metric is valid
            if not metric.get("valid", True):
                finding_counter += 1
                findings.append(_finding(
                    finding_counter, "INVALID_METRIC_REFERENCED", "blocking",
                    "ValidateClaims",
                    f"Claim '{claim_id}' 引用了標記為 invalid 的指標 '{metric_id}'",
                    details={"claimId": claim_id, "metricId": metric_id, "invalidReason": metric.get("invalidReason")},
                ))
                continue

            # Numeric comparison (allow small floating point tolerance)
            if abs(expected_value - actual_value) > 0.01:
                finding_counter += 1
                findings.append(_finding(
                    finding_counter, "NUMERIC_MISMATCH", "blocking",
                    "ValidateClaims",
                    f"Claim '{claim_id}' 中的數字 {actual_value} 與 Evidence 中的 {expected_value} 不一致",
                    details={
                        "claimId": claim_id,
                        "metricId": metric_id,
                        "claimValue": actual_value,
                        "evidenceValue": expected_value,
                        "difference": abs(expected_value - actual_value),
                    },
                ))

            # Check rank if present
            if num.get("unit") == "rank" and metric.get("rank") is not None:
                if int(actual_value) != metric["rank"]:
                    finding_counter += 1
                    findings.append(_finding(
                        finding_counter, "RANKING_MISMATCH", "blocking",
                        "ValidateClaims",
                        f"Claim '{claim_id}' 排名 {int(actual_value)} 與 Evidence 排名 {metric['rank']} 不一致",
                        details={
                            "claimId": claim_id,
                            "claimRank": int(actual_value),
                            "evidenceRank": metric["rank"],
                        },
                    ))

        # Check 3: Unsupported metrics not referenced
        statement = claim.get("statement", "")
        for unsupported_name in unsupported_names:
            if unsupported_name in statement or "年增率" in statement or "YoY" in statement.upper():
                # Check if this claim actually references unsupported metrics
                if _references_unsupported(claim, unsupported_names, metric_index):
                    finding_counter += 1
                    findings.append(_finding(
                        finding_counter, "UNSUPPORTED_METRIC_REFERENCED", "blocking",
                        "ValidateClaims",
                        f"Claim '{claim_id}' 引用了不支援的指標 '{unsupported_name}'",
                        details={"claimId": claim_id, "unsupportedMetric": unsupported_name},
                    ))
                    break

        # Check 4: Direction consistency (e.g., claims A > B must be true)
        direction_issue = _check_direction_consistency(claim, metric_index)
        if direction_issue:
            finding_counter += 1
            findings.append(_finding(
                finding_counter, "DIRECTION_CONTRADICTION", "blocking",
                "ValidateClaims",
                direction_issue["message"],
                details=direction_issue["details"],
            ))

    blocking = sum(1 for f in findings if f["severity"] == "blocking")
    return {
        "passed": blocking == 0,
        "findings": findings,
        "blockingCount": blocking,
    }


def _references_unsupported(
    claim: dict[str, Any],
    unsupported_names: set[str],
    metric_index: dict[str, dict[str, Any]],
) -> bool:
    """Check if a claim's referenced metrics relate to unsupported calculations."""
    statement = claim.get("statement", "").lower()
    return any(name.lower() in statement for name in unsupported_names)


def _check_direction_consistency(
    claim: dict[str, Any],
    metric_index: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Check if direction claims (A > B, increased, decreased) match actual values.
    Returns finding details if inconsistent, None if ok.
    """
    statement = claim.get("statement", "")
    numbers = claim.get("extractedNumbers", [])
    
    if len(numbers) < 2:
        return None

    # Check patterns like "A高於B" or "A大於B"
    comparison_patterns = [
        (r"(\d+\.?\d*)\s*[%％]?\s*高於\s*(\d+\.?\d*)\s*[%％]?", "greater"),
        (r"(\d+\.?\d*)\s*[%％]?\s*大於\s*(\d+\.?\d*)\s*[%％]?", "greater"),
        (r"(\d+\.?\d*)\s*[%％]?\s*低於\s*(\d+\.?\d*)\s*[%％]?", "less"),
        (r"(\d+\.?\d*)\s*[%％]?\s*小於\s*(\d+\.?\d*)\s*[%％]?", "less"),
    ]

    for pattern, direction in comparison_patterns:
        match = re.search(pattern, statement)
        if match:
            val_a = float(match.group(1))
            val_b = float(match.group(2))
            
            if direction == "greater" and val_a <= val_b:
                return {
                    "message": f"Claim '{claim.get('claimId')}' 宣稱 {val_a} 高於 {val_b}，但實際 {val_a} ≤ {val_b}",
                    "details": {
                        "claimId": claim.get("claimId"),
                        "claimedDirection": "greater",
                        "valueA": val_a,
                        "valueB": val_b,
                    },
                }
            elif direction == "less" and val_a >= val_b:
                return {
                    "message": f"Claim '{claim.get('claimId')}' 宣稱 {val_a} 低於 {val_b}，但實際 {val_a} ≥ {val_b}",
                    "details": {
                        "claimId": claim.get("claimId"),
                        "claimedDirection": "less",
                        "valueA": val_a,
                        "valueB": val_b,
                    },
                }

    return None


def _finding(
    counter: int,
    error_type: str,
    severity: str,
    stage: str,
    message: str,
    details: dict | None = None,
) -> dict[str, Any]:
    return {
        "findingId": f"finding-{counter:04d}",
        "errorType": error_type,
        "severity": severity,
        "stage": stage,
        "message": message,
        "details": details or {},
        "recoverable": False,
        "suggestedAction": None,
    }
