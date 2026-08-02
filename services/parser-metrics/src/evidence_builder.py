"""
evidence_builder.py - Assembles and freezes EvidencePacket.
Once frozen, the packet is immutable with a canonical SHA-256 hash.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any


class EvidencePacketBuilder:
    """Builds and freezes an EvidencePacket."""

    def __init__(self, job_id: str, formula_plan_id: str, workbook_info: dict[str, str]):
        self.packet = {
            "packetId": f"evp-{job_id}-v1",
            "jobId": job_id,
            "workbook": workbook_info,
            "formulaPlanId": formula_plan_id,
            "sourceRefs": [],
            "metrics": [],
            "chartDataSpecs": [],
            "validationFindings": [],
            "unsupportedRequests": [],
            "frozen": False,
            "frozenAt": None,
            "canonicalSha256": None,
        }
        self._frozen = False

    def add_source_refs(self, refs: list[dict[str, Any]]) -> None:
        self._check_not_frozen()
        self.packet["sourceRefs"] = refs

    def add_metrics(self, metrics: list[dict[str, Any]]) -> None:
        self._check_not_frozen()
        self.packet["metrics"] = metrics

    def add_chart_data_specs(self, specs: list[dict[str, Any]]) -> None:
        self._check_not_frozen()
        self.packet["chartDataSpecs"] = specs

    def add_validation_findings(self, findings: list[dict[str, Any]]) -> None:
        self._check_not_frozen()
        self.packet["validationFindings"] = findings

    def add_unsupported_requests(self, unsupported: list[dict[str, Any]]) -> None:
        self._check_not_frozen()
        self.packet["unsupportedRequests"] = unsupported

    def freeze(self) -> dict[str, Any]:
        """
        Freeze the evidence packet.
        After freezing, no modifications are allowed.
        Returns the frozen packet with canonical SHA-256.
        """
        self._check_not_frozen()
        self._frozen = True
        self.packet["frozen"] = True
        self.packet["frozenAt"] = datetime.now(timezone.utc).isoformat()
        self.packet["canonicalSha256"] = self._compute_canonical_hash()
        return self.packet

    def _compute_canonical_hash(self) -> str:
        """Compute deterministic SHA-256 hash of the packet content."""
        # Exclude mutable metadata from hash
        hash_data = {
            k: v for k, v in self.packet.items()
            if k not in ("frozenAt", "canonicalSha256", "frozen")
        }
        canonical_json = json.dumps(
            hash_data,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    def _check_not_frozen(self) -> None:
        if self._frozen:
            raise RuntimeError("Cannot modify a frozen EvidencePacket")

    def get_packet(self) -> dict[str, Any]:
        """Get the current packet state (frozen or not)."""
        return self.packet


def build_chart_data_specs(metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Build ChartDataSpec from computed metrics for chart rendering.
    Groups metrics by name and creates data series per entity.
    """
    from collections import defaultdict

    # Group: metricName -> {entity -> [(period, value)]}
    grouped: dict[str, dict[str, list[tuple[str, float]]]] = defaultdict(lambda: defaultdict(list))
    metric_ids_by_name: dict[str, list[str]] = defaultdict(list)

    for m in metrics:
        if m["valid"] and m["entity"] != "全體銀行":
            name = m["metricName"]
            entity = m["entity"]
            grouped[name][entity].append((m["period"], m["computedValue"]))
            metric_ids_by_name[name].append(m["metricId"])

    chart_specs = []
    for idx, (metric_name, entities_data) in enumerate(grouped.items(), start=1):
        # Get all periods (sorted)
        all_periods: set[str] = set()
        for entity_periods in entities_data.values():
            for period, _ in entity_periods:
                all_periods.add(period)
        categories = sorted(all_periods)

        # Build series (top 5 entities by average value)
        entity_avgs = {}
        for entity, period_values in entities_data.items():
            values = [v for _, v in period_values]
            entity_avgs[entity] = sum(values) / len(values) if values else 0

        top_entities = sorted(entity_avgs.keys(), key=lambda e: entity_avgs[e], reverse=True)[:5]

        series = []
        for entity in top_entities:
            period_map = dict(entities_data[entity])
            values = [period_map.get(p, 0.0) for p in categories]
            series.append({"name": entity, "values": values})

        chart_specs.append({
            "chartDataSpecId": f"chart-{idx:03d}",
            "metricName": metric_name,
            "chartType": "line",
            "categories": categories,
            "series": series,
            "metricIds": metric_ids_by_name[metric_name][:20],  # Limit for payload size
        })

    return chart_specs
