"""
insight_lens.py - Three Insight Lenses: Market Competition, Business Performance, Risk Audit.
Each lens reads only the frozen EvidencePacket and produces RoleInsight output.
"""
import json
from datetime import datetime, timezone
from typing import Any

from .converse_client import BedrockConverseClient
from .groq_client import ConverseRequest


def get_client():
    """Get the best available client: Groq (free + fast) > Ollama (local) > Bedrock (cloud)."""
    import os
    
    # Priority 1: Groq (free, fast, reliable)
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if groq_key:
        from .groq_client import GroqClient
        print("[InsightLens] Using Groq (free tier) backend", flush=True)
        return GroqClient(api_key=groq_key)
    
    # Priority 2: Ollama (local)
    from .ollama_client import OllamaClient, is_ollama_available
    if is_ollama_available():
        print("[InsightLens] Using Ollama (local) backend", flush=True)
        return OllamaClient()
    
    # Priority 3: Bedrock (cloud)
    print("[InsightLens] Using Bedrock (cloud) backend", flush=True)
    return BedrockConverseClient()


# ─── Output Schema for RoleInsight ────────────────────────────

ROLE_INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "claimId": {"type": "string"},
                    "claimKey": {"type": "string"},
                    "statement": {"type": "string"},
                    "evidenceIds": {"type": "array", "items": {"type": "string"}},
                    "businessImplication": {"type": "string"},
                    "caveats": {"type": "array", "items": {"type": "string"}},
                    "direction": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                    "magnitude": {"type": "string", "enum": ["high", "moderate", "low"]},
                },
                "required": ["claimId", "claimKey", "statement", "evidenceIds"],
            },
        },
    },
    "required": ["claims"],
}


# ─── System Prompts ───────────────────────────────────────────

MARKET_COMPETITION_PROMPT = """你是一位金融市場分析師，專注於信用卡市場競爭分析。

## 角色定義
你的任務是從 EvidencePacket 中的已驗證指標，分析台新銀行在信用卡市場的競爭地位。

## 嚴格限制
1. 你只能引用 EvidencePacket 中已有的 MetricRecord（使用 metricId 作為 evidenceId）
2. 不得自行計算任何數字
3. 不得引入未收錄於 EvidencePacket 的外部市場資料
4. 每個 Claim 都必須附帶至少一個 evidenceId
5. 不得引用被標記為 unsupported 的指標

## 分析方向
- 市占率趨勢與同業比較
- 排名變化
- 簽帳金額規模比較

## 輸出格式
產生 JSON，每個 claim 包含：claimId, claimKey (格式: entity|metric|period), statement, evidenceIds, businessImplication, caveats, direction, magnitude
"""

BUSINESS_PERFORMANCE_PROMPT = """你是一位金融經營績效分析師，專注於信用卡業務營運指標。

## 角色定義
你的任務是從 EvidencePacket 中的已驗證指標，分析信用卡業務的經營績效。

## 嚴格限制
1. 你只能引用 EvidencePacket 中已有的 MetricRecord
2. 不得自行計算任何數字
3. 不得自行計算或假設未在 EvidencePacket 中的獲利資料
4. 每個 Claim 都必須附帶至少一個 evidenceId
5. 不得引用被標記為 unsupported 的指標

## 分析方向
- 活躍卡率與有效卡率
- 單卡消費金額趨勢
- 月增率 (MoM) 表現
- 各指標的業務意涵

## 輸出格式
產生 JSON，每個 claim 包含：claimId, claimKey, statement, evidenceIds, businessImplication, caveats, direction, magnitude
"""

RISK_AUDIT_PROMPT = """你是一位金融風險稽核專家，專注於信用卡報表品質與風險偵測。

## 角色定義
你的任務是從 EvidencePacket 中識別資料品質問題、風險指標與需要揭露的事項。

## 嚴格限制
1. 你只能引用 EvidencePacket 中已有的 MetricRecord 和 ValidationFindings
2. 不得以解釋方式放行數字矛盾
3. 不得自行計算數字
4. 每個 Claim 都必須附帶至少一個 evidenceId
5. 必須明確指出資料缺漏與不支援的指標

## 分析方向
- 缺漏期間或資料
- 異常值（如突然大幅變動）
- 不支援的指標（如缺少去年同期的 YoY）
- 可能的風險揭露事項
- 報表品質問題

## 輸出格式
產生 JSON，每個 claim 包含：claimId, claimKey, statement, evidenceIds, businessImplication, caveats, direction, magnitude
"""


class InsightLens:
    """Executes a single Insight Lens against a frozen EvidencePacket."""

    def __init__(self, client: BedrockConverseClient, role: str):
        self.client = client
        self.role = role
        self.system_prompt = self._get_system_prompt()

    def execute(self, evidence_packet: dict[str, Any]) -> dict[str, Any]:
        """
        Execute the lens and produce RoleInsight output.
        
        Args:
            evidence_packet: Frozen EvidencePacket dict
        
        Returns:
            RoleInsight dict with claims and metadata
        """
        if not evidence_packet.get("frozen"):
            raise ValueError("EvidencePacket must be frozen before lens execution")

        # Build user message with evidence data
        user_message = self._build_user_message(evidence_packet)

        request = ConverseRequest(
            system_prompt=self.system_prompt,
            user_message=user_message,
            output_schema=ROLE_INSIGHT_SCHEMA,
            max_tokens=4096,
            temperature=0.1,
        )

        response = self.client.invoke(request)

        # Build RoleInsight
        claims = response.parsed_output.get("claims", [])
        
        # Add sourceRole and extractedNumbers to each claim
        processed_claims = []
        for claim in claims:
            claim["sourceRole"] = self.role
            claim["status"] = "pending"
            claim["extractedNumbers"] = self._extract_numbers(claim, evidence_packet)
            processed_claims.append(claim)

        return {
            "role": self.role,
            "packetId": evidence_packet["packetId"],
            "claims": processed_claims,
            "metadata": {
                "modelId": response.model_id,
                "promptHash": response.prompt_hash,
                "skillVersion": "v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            },
        }

    def _get_system_prompt(self) -> str:
        prompts = {
            "market_competition": MARKET_COMPETITION_PROMPT,
            "business_performance": BUSINESS_PERFORMANCE_PROMPT,
            "risk_audit": RISK_AUDIT_PROMPT,
        }
        return prompts.get(self.role, MARKET_COMPETITION_PROMPT)

    def _build_user_message(self, packet: dict[str, Any]) -> str:
        """Build user message containing evidence data for the lens."""
        # Include metrics summary (limit to avoid token overflow)
        metrics_summary = []
        for m in packet.get("metrics", [])[:15]:  # Limit for Groq free tier token budget
            if m.get("valid"):
                metrics_summary.append({
                    "metricId": m["metricId"],
                    "name": m["metricName"],
                    "entity": m["entity"],
                    "period": m["period"],
                    "value": m["computedValue"],
                    "unit": m["unit"],
                    "rank": m.get("rank"),
                })

        unsupported = packet.get("unsupportedRequests", [])
        
        data = {
            "packetId": packet["packetId"],
            "metrics": metrics_summary,
            "unsupportedRequests": unsupported,
        }

        return (
            "以下是已凍結的 EvidencePacket 摘要。請根據這些已驗證指標產生分析洞察。\n\n"
            f"```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```\n\n"
            "請產生 JSON 格式的 claims 陣列，每個 claim 必須引用上方 metrics 中的 metricId 作為 evidenceIds。"
        )

    def _extract_numbers(self, claim: dict[str, Any], packet: dict[str, Any]) -> list[dict[str, Any]]:
        """Extract referenced numbers from claim based on evidenceIds."""
        metric_index = {m["metricId"]: m for m in packet.get("metrics", [])}
        extracted = []
        
        for eid in claim.get("evidenceIds", []):
            metric = metric_index.get(eid)
            if metric:
                extracted.append({
                    "value": metric["computedValue"],
                    "unit": metric["unit"],
                    "metricId": eid,
                })
        
        return extracted


async def run_lenses_parallel(
    client,
    evidence_packet: dict[str, Any],
) -> dict[str, Any]:
    """
    Run all three lenses. In production this uses Step Functions Parallel.
    For local dev, we run sequentially with error handling.
    Client can be either BedrockConverseClient or OllamaClient.
    
    Returns:
        Combined results dict with all claims and any failures
    """
    roles = ["market_competition", "business_performance", "risk_audit"]
    results: dict[str, Any] = {
        "allClaims": [],
        "insights": [],
        "failures": [],
    }

    for role in roles:
        try:
            lens = InsightLens(client, role)
            insight = lens.execute(evidence_packet)
            results["insights"].append(insight)
            results["allClaims"].extend(insight["claims"])
        except Exception as e:
            results["failures"].append({
                "role": role,
                "error": str(e),
                "type": type(e).__name__,
            })

    return results
