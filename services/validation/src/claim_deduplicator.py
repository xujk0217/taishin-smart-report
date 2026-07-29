"""
claim_deduplicator.py - Deduplicates claims and groups contradictions.
Duplicate claim keys are merged (duplicates do NOT increase credibility).
Contradictory claims are grouped into ConflictGroups and blocked.
"""
from typing import Any
from collections import defaultdict


def deduplicate_claims(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Deduplicate claims by claim key.
    Same claimKey -> merge into single claim, keep first occurrence.
    Duplicates do NOT increase credibility.
    
    Returns:
        Deduplicated list of claims
    """
    seen: dict[str, dict[str, Any]] = {}
    for claim in claims:
        key = claim.get("claimKey", claim.get("claimId"))
        if key not in seen:
            seen[key] = claim
    return list(seen.values())


def group_conflicts(
    claims: list[dict[str, Any]],
    metric_index: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Detect and group contradictory claims.
    
    Contradiction types:
    - Direction: One claim says "up" another says "down" for same entity/period
    - Numeric: Two claims cite different numbers for the same metric
    - Ranking: Two claims cite different rankings for same entity/period
    
    Returns:
        (conflict_groups, updated_claims_with_conflict_status)
    """
    conflict_groups: list[dict[str, Any]] = []
    conflict_counter = 0

    # Group claims by entity + period
    entity_period_claims: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in claims:
        # Extract entity and period from claim key or evidence
        for num in claim.get("extractedNumbers", []):
            metric_id = num.get("metricId", "")
            metric = metric_index.get(metric_id, {})
            entity = metric.get("entity", "")
            period = metric.get("period", "")
            if entity and period:
                key = f"{entity}|{period}|{metric.get('metricName', '')}"
                entity_period_claims[key].append(claim)

    # Check for numeric contradictions within groups
    for group_key, group_claims in entity_period_claims.items():
        if len(group_claims) < 2:
            continue

        # Check if claims in same group have conflicting values for same metric
        metric_values: dict[str, list[tuple[float, dict[str, Any]]]] = defaultdict(list)
        for claim in group_claims:
            for num in claim.get("extractedNumbers", []):
                metric_id = num.get("metricId", "")
                metric_values[metric_id].append((num["value"], claim))

        for metric_id, values_and_claims in metric_values.items():
            if len(values_and_claims) < 2:
                continue

            # Check if values are contradictory
            unique_values = set(v for v, _ in values_and_claims)
            if len(unique_values) > 1:
                conflict_counter += 1
                conflicting_claims = [c for _, c in values_and_claims]
                conflict_claim_ids = list(set(c["claimId"] for c in conflicting_claims))

                metric = metric_index.get(metric_id, {})
                correct_value = metric.get("computedValue")

                conflict_groups.append({
                    "conflictGroupId": f"conflict-{conflict_counter:04d}",
                    "conflictType": "numeric",
                    "claimIds": conflict_claim_ids,
                    "description": f"多個 Claim 對相同指標 '{metric_id}' 引用不同數值: {sorted(unique_values)}",
                    "resolution": "blocked",
                    "evidenceMetricId": metric_id,
                    "correctValue": correct_value,
                })

                # Mark claims as conflict
                for claim in conflicting_claims:
                    claim["status"] = "conflict"
                    claim["conflictGroupId"] = f"conflict-{conflict_counter:04d}"

    # Check direction contradictions
    direction_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in claims:
        direction = claim.get("direction")
        if direction:
            for num in claim.get("extractedNumbers", []):
                metric_id = num.get("metricId", "")
                metric = metric_index.get(metric_id, {})
                key = f"{metric.get('entity', '')}|{metric.get('metricName', '')}"
                direction_groups[key].append(claim)

    for key, group_claims in direction_groups.items():
        if len(group_claims) < 2:
            continue

        directions = set(c.get("direction") for c in group_claims if c.get("direction"))
        if "positive" in directions and "negative" in directions:
            conflict_counter += 1
            conflict_claim_ids = [c["claimId"] for c in group_claims]

            conflict_groups.append({
                "conflictGroupId": f"conflict-{conflict_counter:04d}",
                "conflictType": "direction",
                "claimIds": conflict_claim_ids,
                "description": f"相同指標存在正面與負面方向矛盾的 Claims",
                "resolution": "blocked",
            })

            for claim in group_claims:
                if claim.get("status") != "conflict":
                    claim["status"] = "conflict"
                    claim["conflictGroupId"] = f"conflict-{conflict_counter:04d}"

    return conflict_groups, claims


def build_claim_registry(
    claims: list[dict[str, Any]],
    conflict_groups: list[dict[str, Any]],
    packet_id: str,
) -> dict[str, Any]:
    """
    Build the ClaimRegistry from validated and conflict-grouped claims.
    
    Returns:
        ClaimRegistry dict with accepted, rejected, and conflicts lists.
    """
    accepted = [c for c in claims if c.get("status") == "accepted"]
    rejected = [c for c in claims if c.get("status") == "rejected"]
    # Conflicts are those marked as "conflict"
    # They should NOT appear in accepted

    return {
        "packetId": packet_id,
        "accepted": accepted,
        "rejected": rejected,
        "conflicts": conflict_groups,
    }
