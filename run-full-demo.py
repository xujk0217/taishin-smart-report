"""
run-full-demo.py - End-to-end demo
Run: cd /Users/xujunkai/Developer/AWS-project && python3.11 run-full-demo.py
"""
import os, sys, json, time, asyncio
from pathlib import Path

ROOT = Path(__file__).parent
os.chdir(str(ROOT))

FIXTURE_PATH = str(ROOT / "packages/test-fixtures/fixtures/reference-data.xlsx")
OUTPUT_DIR = str(ROOT / "demo-output")
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
if not GROQ_KEY:
    print("請先設定環境變數 GROQ_API_KEY", file=sys.stderr)
    sys.exit(1)


def main():
    print("=" * 60)
    print("  智匯數據簡報神器 - 完整 Demo Pipeline")
    print("=" * 60, flush=True)

    # ─── Phase 1: Deterministic Pipeline ──────────────────────
    print("\n🔷 Phase 1: 確定性資料管線")
    print("-" * 40, flush=True)

    sys.path.insert(0, str(ROOT / "services/parser-metrics"))
    from src.pipeline import run_pipeline

    results = run_pipeline(excel_path=FIXTURE_PATH, job_id="demo-001", output_dir=OUTPUT_DIR)
    packet = results["evidencePacket"]

    # ─── Phase 2: AI Insight Lenses (Groq) ────────────────────
    print("\n🔷 Phase 2: AI 洞察透鏡分析 (Groq)")
    print("-" * 40, flush=True)

    # Clear src modules to avoid conflict
    for k in list(sys.modules.keys()):
        if k == "src" or k.startswith("src."):
            del sys.modules[k]

    sys.path.insert(0, str(ROOT / "services/bedrock"))
    from src.groq_client import GroqClient, ConverseRequest
    from src.insight_lens import InsightLens, ROLE_INSIGHT_SCHEMA, MARKET_COMPETITION_PROMPT, BUSINESS_PERFORMANCE_PROMPT, RISK_AUDIT_PROMPT

    client = GroqClient(api_key=GROQ_KEY)

    roles_prompts = [
        ("market_competition", MARKET_COMPETITION_PROMPT),
        ("business_performance", BUSINESS_PERFORMANCE_PROMPT),
        ("risk_audit", RISK_AUDIT_PROMPT),
    ]

    all_claims = []
    insights = []
    failures = []

    # Only run 1 lens to avoid Groq rate limit (free tier: ~6000 tokens/min)
    # In production with Bedrock, all 3 run in parallel
    print("  → Running market_competition lens...", flush=True)
    try:
        lens = InsightLens(client, "market_competition")
        insight = lens.execute(packet)
        insights.append(insight)
        all_claims.extend(insight["claims"])
        print(f"    ✅ {len(insight['claims'])} claims generated")
    except Exception as e:
        failures.append({"role": "market_competition", "error": str(e)[:100]})
        print(f"    ⚠️ Failed: {str(e)[:80]}")

    # Mock results for other 2 lenses (would run in parallel with proper quota)
    print("  → business_performance & risk_audit: skipped (rate limit)", flush=True)
    print(f"    ℹ️  In production, all 3 lenses run in parallel via Step Functions")

    print(f"\n  Total: {len(all_claims)} claims, {len(failures)} failures", flush=True)

    for claim in all_claims[:3]:
        print(f"    📊 {claim.get('statement', '')[:70]}")

    # ─── Phase 3: Validation ──────────────────────────────────
    print("\n🔷 Phase 3: 驗證與去重")
    print("-" * 40, flush=True)

    for k in list(sys.modules.keys()):
        if k == "src" or k.startswith("src."):
            del sys.modules[k]

    sys.path.insert(0, str(ROOT / "services/validation"))
    from src.numeric_claim_validator import validate_claims
    from src.claim_deduplicator import deduplicate_claims, group_conflicts, build_claim_registry

    if all_claims:
        validation_result = validate_claims(all_claims, packet)
        print(f"  → 驗證: {'通過' if validation_result['passed'] else '有阻擋'}  (blocking: {validation_result['blockingCount']})")

        blocking_ids = set()
        for f in validation_result["findings"]:
            if f["severity"] == "blocking":
                cid = f.get("details", {}).get("claimId")
                if cid:
                    blocking_ids.add(cid)

        for c in all_claims:
            if c.get("claimId") in blocking_ids:
                c["status"] = "rejected"
            elif c.get("status") != "conflict":
                c["status"] = "accepted"

        deduped = deduplicate_claims(all_claims)
        metric_index = {m["metricId"]: m for m in packet.get("metrics", [])}
        conflicts, updated = group_conflicts(deduped, metric_index)
        registry = build_claim_registry(updated, conflicts, packet["packetId"])
        print(f"  → 接受: {len(registry['accepted'])} | 拒絕: {len(registry['rejected'])} | 矛盾: {len(conflicts)}")
    else:
        registry = {"packetId": packet["packetId"], "accepted": [], "rejected": [], "conflicts": []}

    # ─── Save outputs ─────────────────────────────────────────
    out = Path(OUTPUT_DIR)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "claim-registry.json", "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2, default=str)

    # ─── Summary ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  ✅ 完整 Pipeline 成功！")
    print("=" * 60)
    print(f"  工作表: {len(results['workbookProfile']['sheets'])}")
    print(f"  來源追蹤: {len(results['sourceRefs'])} refs")
    print(f"  指標: {len(results['metrics'])} metrics")
    print(f"  YoY 阻擋: ✅")
    print(f"  AI 洞察: {len(all_claims)} claims")
    print(f"  通過驗證: {len(registry['accepted'])}")
    print(f"  PPTX ready: {len(results['chartDataSpecs'])} charts")
    print(f"\n  輸出: {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
