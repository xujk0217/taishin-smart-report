"""
metric_engine.py - Deterministic metric computation engine.
Computes market share, rankings, MoM, active card rate, etc.
All calculations are pure functions with full source traceability.
"""
from typing import Any, Optional


class MetricEngine:
    """
    Deterministic computation engine.
    Takes approved FormulaPlan + SourceRefs and computes all metrics.
    """

    def __init__(self, source_refs: list[dict[str, Any]], formula_plan: dict[str, Any]):
        self.source_refs = source_refs
        self.formula_plan = formula_plan
        self._ref_index = self._build_index()

    def _build_index(self) -> dict[str, list[dict[str, Any]]]:
        """Build lookup index: (entity, period, sheetName) -> list of SourceRefs."""
        index: dict[str, list[dict[str, Any]]] = {}
        for ref in self.source_refs:
            key = f"{ref['entity']}|{ref['period']}|{ref['sheetName']}"
            index.setdefault(key, []).append(ref)
        return index

    def compute_all(self) -> list[dict[str, Any]]:
        """Compute all metrics defined in the approved formula plan."""
        metrics: list[dict[str, Any]] = []
        metric_counter = 0

        for formula in self.formula_plan.get("formulas", []):
            if not formula.get("supported", True):
                continue

            formula_id = formula["formulaId"]
            definition = formula["definition"]
            
            # Compute for each period and entity combination
            computed = self._compute_formula(formula)
            for result in computed:
                metric_counter += 1
                metrics.append({
                    "metricId": f"metric-{metric_counter:06d}",
                    "metricName": formula.get("name", formula_id),
                    "formulaId": formula_id,
                    "formulaDefinition": definition,
                    "inputSourceIds": result["inputSourceIds"],
                    "computedValue": result["value"],
                    "unit": formula.get("unit", "percent"),
                    "period": result["period"],
                    "entity": result["entity"],
                    "rank": None,
                    "rankTotal": None,
                    "computationSteps": result["steps"],
                    "valid": result["valid"],
                    "invalidReason": result.get("invalidReason"),
                })

        # Compute rankings within same period and metric
        metrics = self._compute_rankings(metrics)
        return metrics

    def _compute_formula(self, formula: dict[str, Any]) -> list[dict[str, Any]]:
        """Compute a single formula across all applicable entity/period combos."""
        formula_id = formula["formulaId"]
        definition = formula["definition"]
        results: list[dict[str, Any]] = []

        # Get all unique periods and entities
        periods = sorted(set(ref["period"] for ref in self.source_refs))
        entities = sorted(set(
            ref["entity"] for ref in self.source_refs 
            if ref["entity"] != "全體銀行"
        ))

        if "market_share" in formula_id or "市占" in definition:
            results = self._compute_market_share(formula, periods, entities)
        elif "mom" in formula_id.lower() or "月增" in definition:
            results = self._compute_mom(formula, periods, entities)
        elif "ratio" in formula_id or "率" in definition:
            results = self._compute_ratio(formula, periods, entities)
        else:
            # Generic: just pass through the value from source
            results = self._compute_passthrough(formula, periods, entities)

        return results

    def _compute_market_share(
        self, formula: dict, periods: list[str], entities: list[str]
    ) -> list[dict[str, Any]]:
        """Compute market share: entity_value / total_value * 100."""
        results = []
        inputs = formula.get("inputs", [])
        if not inputs:
            return results

        sheet_name = inputs[0].get("sheet", "")

        for period in periods:
            # Find total (全體銀行) value for this period and sheet
            total_key = f"全體銀行|{period}|{sheet_name}"
            total_refs = self._ref_index.get(total_key, [])
            total_value = total_refs[0]["normalizedValue"] if total_refs else None

            for entity in entities:
                entity_key = f"{entity}|{period}|{sheet_name}"
                entity_refs = self._ref_index.get(entity_key, [])
                
                if not entity_refs:
                    continue

                entity_value = entity_refs[0]["normalizedValue"]
                input_ids = [entity_refs[0]["sourceId"]]
                
                if total_refs:
                    input_ids.append(total_refs[0]["sourceId"])

                if total_value is None or total_value == 0:
                    results.append({
                        "value": 0.0,
                        "period": period,
                        "entity": entity,
                        "inputSourceIds": input_ids,
                        "steps": [f"total_value is 0 or missing for {period}"],
                        "valid": False,
                        "invalidReason": "Division by zero: total value is 0 or missing",
                    })
                else:
                    share = round(entity_value / total_value * 100, 2)
                    steps = [
                        f"{entity_refs[0]['sourceId']}.value ({entity_value}) / "
                        f"{total_refs[0]['sourceId']}.value ({total_value}) * 100 = {share}"
                    ]
                    results.append({
                        "value": share,
                        "period": period,
                        "entity": entity,
                        "inputSourceIds": input_ids,
                        "steps": steps,
                        "valid": True,
                    })

        return results

    def _compute_mom(
        self, formula: dict, periods: list[str], entities: list[str]
    ) -> list[dict[str, Any]]:
        """Compute Month-over-Month growth rate."""
        results = []
        inputs = formula.get("inputs", [])
        if not inputs:
            return results
        sheet_name = inputs[0].get("sheet", "")

        for i, period in enumerate(periods):
            if i == 0:
                continue  # No previous month for first period
            prev_period = periods[i - 1]

            for entity in entities:
                curr_key = f"{entity}|{period}|{sheet_name}"
                prev_key = f"{entity}|{prev_period}|{sheet_name}"
                curr_refs = self._ref_index.get(curr_key, [])
                prev_refs = self._ref_index.get(prev_key, [])

                if not curr_refs or not prev_refs:
                    continue

                curr_val = curr_refs[0]["normalizedValue"]
                prev_val = prev_refs[0]["normalizedValue"]
                input_ids = [curr_refs[0]["sourceId"], prev_refs[0]["sourceId"]]

                if prev_val == 0:
                    results.append({
                        "value": 0.0,
                        "period": period,
                        "entity": entity,
                        "inputSourceIds": input_ids,
                        "steps": [f"prev_value is 0 for {prev_period}"],
                        "valid": False,
                        "invalidReason": "Division by zero: previous period value is 0",
                    })
                else:
                    mom = round((curr_val - prev_val) / prev_val * 100, 2)
                    steps = [
                        f"({curr_refs[0]['sourceId']}.value ({curr_val}) - "
                        f"{prev_refs[0]['sourceId']}.value ({prev_val})) / "
                        f"{prev_refs[0]['sourceId']}.value ({prev_val}) * 100 = {mom}"
                    ]
                    results.append({
                        "value": mom,
                        "period": period,
                        "entity": entity,
                        "inputSourceIds": input_ids,
                        "steps": steps,
                        "valid": True,
                    })

        return results

    def _compute_ratio(
        self, formula: dict, periods: list[str], entities: list[str]
    ) -> list[dict[str, Any]]:
        """Compute a ratio metric (pass through percentage values)."""
        results = []
        inputs = formula.get("inputs", [])
        if not inputs:
            return results
        sheet_name = inputs[0].get("sheet", "")

        for period in periods:
            for entity in entities:
                key = f"{entity}|{period}|{sheet_name}"
                refs = self._ref_index.get(key, [])
                if not refs:
                    continue
                val = refs[0]["normalizedValue"]
                results.append({
                    "value": val,
                    "period": period,
                    "entity": entity,
                    "inputSourceIds": [refs[0]["sourceId"]],
                    "steps": [f"{refs[0]['sourceId']}.value = {val}"],
                    "valid": True,
                })
        return results

    def _compute_passthrough(
        self, formula: dict, periods: list[str], entities: list[str]
    ) -> list[dict[str, Any]]:
        """Pass through raw values as metrics."""
        results = []
        inputs = formula.get("inputs", [])
        if not inputs:
            return results
        sheet_name = inputs[0].get("sheet", "")

        for period in periods:
            for entity in entities:
                key = f"{entity}|{period}|{sheet_name}"
                refs = self._ref_index.get(key, [])
                if not refs:
                    continue
                val = refs[0]["normalizedValue"]
                results.append({
                    "value": val,
                    "period": period,
                    "entity": entity,
                    "inputSourceIds": [refs[0]["sourceId"]],
                    "steps": [f"{refs[0]['sourceId']}.value = {val}"],
                    "valid": True,
                })
        return results

    def _compute_rankings(self, metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Compute rankings within same (metricName, period) group."""
        from collections import defaultdict

        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for m in metrics:
            if m["valid"]:
                key = f"{m['metricName']}|{m['period']}"
                groups[key].append(m)

        for key, group in groups.items():
            # Sort descending by value for market share and amounts
            sorted_group = sorted(group, key=lambda x: x["computedValue"], reverse=True)
            total = len(sorted_group)
            for rank, item in enumerate(sorted_group, start=1):
                item["rank"] = rank
                item["rankTotal"] = total

        return metrics
