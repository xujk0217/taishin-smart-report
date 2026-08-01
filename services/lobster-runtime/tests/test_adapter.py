"""Contract tests for AI-driven planning with deterministic governance validation."""

from __future__ import annotations

import importlib.metadata
import json
from copy import deepcopy
from typing import Any, AsyncGenerator, AsyncIterable

import pytest
from pydantic import ValidationError
from strands.models import Model

from lobster_runtime import ALLOWED_TOOLS, AIPlanningOutput, StrandsLobsterRuntimeAdapter
from lobster_runtime.contracts import CalculationPlanningStageOutput, FormulaPlan, PromptContract
from lobster_runtime.planner import validate_planning_output


def planning_payload() -> dict[str, Any]:
    stages = [
        ("s1", "understand", ["contract"]),
        ("s2", "acquire", ["data-read", "research"]),
        ("s3", "analyze", ["calculation", "analysis"]),
        ("s4", "compose", ["deck-planning"]),
        ("s5", "render-verify", ["rendering", "inspection"]),
    ]
    return {
        "output_version": "ai-planning-output-v3",
        "prompt_contract": {
            "contract_version": "prompt-contract-v3",
            "user_intent": "向兒童解釋城市水循環並設計互動活動",
            "presentation_goal": "讓學生理解概念並能完成小組任務",
            "target_audience": "國小高年級學生",
            "language": "zh-TW",
            "recommended_page_count": 5,
            "page_count_origin": "recommended",
            "page_count_rationale": "配合短講與活動時間",
            "tone_and_style": ["故事化", "友善"],
            "visual_direction": ["手繪感", "高辨識圖示"],
            "metrics": [{"metric_id": "m1", "name": "活動完成度", "purpose": "確認學習成果", "definition_needed": "完成活動人數除以參與人數", "calculation_required": True, "origin": "recommended", "required": True, "custom_fields": {}}],
            "charts": [{"chart_id": "c1", "title": "城市水循環概念圖", "visualization": "互動式概念地圖", "purpose": "連結降雨、排水、使用與回收", "data_requirements": ["活動紀錄"], "formula_ids": ["f1"], "calculation_task_ids": ["calc1"], "origin": "inferred", "rationale": "比數值圖更適合概念教學", "required": True, "custom_fields": {}}],
            "insights": [{"insight_id": "i1", "question": "學生最容易在哪個環節誤解？", "purpose": "安排教學重點", "evidence_needed": ["教師觀察或教學資料"], "origin": "inferred", "required": True, "custom_fields": {}}],
            "data_requirements": ["城市水循環基礎資料"],
            "research_requirements": ["適齡公開科普來源"],
            "formula_requirements": [],
            "content_constraints": ["不得捏造地方統計"],
            "output_requirements": ["原生可編輯簡報"],
            "custom_requirements": [{"requirement_id": "r1", "category": "互動活動", "description": "安排一個小組排序任務", "origin": "explicit", "acceptance_criteria": ["可在五分鐘內完成"], "custom_fields": {}}],
            "assumptions": ["課堂可使用投影設備"],
            "ambiguities": ["是否需要符合特定課綱"],
            "custom_fields": {},
        },
        "formula_plan": {
            "plan_version": "formula-plan-v1",
            "research_strategy": "model-knowledge-only",
            "formulas": [{
                "formula_id": "f1", "name": "活動完成率", "purpose": "量化完成度",
                "expression": "completed / participants * 100",
                "variables": [
                    {"symbol": "completed", "definition": "完成活動人數", "expected_unit": "人"},
                    {"symbol": "participants", "definition": "參與活動人數", "expected_unit": "人"},
                ],
                "output_unit": "%", "applicability_conditions": ["參與人數大於零"],
                "assumptions": ["每位學生只計一次"], "missing_data_policy": "缺值時停止並回報",
                "zero_division_policy": "參與人數為零時不計算並回報",
                "source_candidates": [{"source_type": "model-knowledge", "title": "一般比例定義", "locator": "model-knowledge:ratio", "rationale": "基本比例公式", "verification_state": "unverified"}],
                "status": "needs-user-confirmation", "required": True, "custom_fields": {},
            }],
            "unresolved_questions": ["工作簿欄位名稱是否與規劃一致"], "custom_fields": {},
        },
        "calculation_plan": {
            "plan_version": "calculation-plan-v1",
            "generated_code_policy": {"language": "python", "allowed_libraries": ["python-standard-library", "openpyxl"], "network_access": False, "read_only_inputs": True, "forbidden_operations": ["修改來源檔案", "執行外部命令"]},
            "tasks": [{
                "task_id": "calc1", "output_metric_id": "m1", "formula_id": "f1", "objective": "使用實際 Excel 計算活動完成率",
                "input_bindings": [
                    {"variable": "completed", "workbook_upload_id": "upload-activity", "workbook_selector": "activity.xlsx", "sheet_selector": "活動紀錄", "column_selector": "完成狀態", "cell_range_hint": "", "aggregation": "計算已完成列數", "required": True},
                    {"variable": "participants", "workbook_upload_id": "upload-activity", "workbook_selector": "activity.xlsx", "sheet_selector": "活動紀錄", "column_selector": "學生編號", "cell_range_hint": "", "aggregation": "計算唯一學生數", "required": True},
                ],
                "output_fields": ["value", "unit", "source_refs", "calculation_steps"],
                "code_generation_instructions": ["使用 openpyxl read_only 與 data_only 讀取"],
                "validation_checks": ["結果介於 0 與 100"],
                "provenance_requirements": ["保存檔案、工作表、欄位與儲存格範圍"], "custom_fields": {},
            }],
            "execution_order": ["calc1"], "custom_fields": {},
        },
        "presentation_generation_plan": {
            "plan_version": "presentation-generation-plan-v1",
            "template_analysis": {"template_required": True, "classification_rules": ["依 placeholder、master 與視覺結構判斷頁面角色"], "required_slide_roles": ["cover", "content", "back-cover"], "inspect_master_layouts": True, "inspect_placeholders": True, "inspect_theme_and_dimensions": True, "preserve_unmodified_template_objects": True},
            "python_generation": {"language": "python", "primary_library": "python-pptx", "generation_steps": ["讀取範本", "分類版型", "依 DeckPlan 生成"], "editable_object_requirements": ["文字與圖表保持原生可編輯"], "fidelity_checks": ["頁數與核准計畫一致"]},
            "layout_consistency_rules": ["圖表與文字比例依核准版面規格一致"],
            "preview_editing": {"manual_editable_fields": ["title", "text", "chart", "page_order", "page_count"], "natural_language_editing": True, "revision_behavior": ["每次修改重新驗證完整計畫與產物"]},
            "provenance_display": {"required_fields": ["workbook", "sheet", "columns", "cell_range", "formula", "calculation_steps", "result", "unit"], "show_per_chart": True, "show_only_actual_data": True},
            "final_export_requirements": ["輸出可編輯 PPTX", "不得含 synthetic 資料"], "custom_fields": {},
        },
        "execution_plan": {
            "stages": [{
                "stage_id": stage_id,
                "stage_class": stage_class,
                "objective": f"AI dynamically plans work for {stage_class}",
                "planned_activities": ["由 AI 根據 Prompt 決定具體工作"],
                "required_inputs": ["前一階段已驗證輸出"],
                "allowed_tool_categories": categories,
                "required_outputs": ["版本化 stage manifest"],
                "validation_checks": ["獨立檢查輸出與 Prompt 覆蓋"],
                "completion_criteria": ["必要輸出存在且驗證通過"],
                "requires_user_approval": stage_class in {"understand", "render-verify"},
            } for stage_id, stage_class, categories in stages],
        },
        "deck_plan": {
            "plan_version": "deck-plan-v3",
            "title": "城市裡的水去哪裡？",
            "subtitle": "一起完成水循環任務",
            "total_pages": 5,
            "narrative_strategy": "用一段城市雨天故事串起概念與活動",
            "narrative_arc": ["提出問題", "理解系統", "完成任務"],
            "slides": [
                {"page_number": 1, "kind": "cover", "title": "城市裡的水去哪裡？", "communication_goal": "引起好奇", "key_message": "從一場雨開始探索", "content_elements": ["主標題", "故事情境"], "metric_ids": [], "formula_ids": [], "chart_ids": [], "insight_ids": [], "custom_requirement_ids": [], "evidence_requirements": [], "layout_guidance": "大圖封面", "speaker_notes_guidance": "先提問", "editable": True, "custom_fields": {}},
                {"page_number": 2, "kind": "content", "title": "今天的任務", "communication_goal": "建立學習目標", "key_message": "完成後能說明水的路徑", "content_elements": ["任務", "成功條件"], "metric_ids": ["m1"], "formula_ids": [], "chart_ids": [], "insight_ids": [], "custom_requirement_ids": [], "evidence_requirements": [], "layout_guidance": "任務卡", "speaker_notes_guidance": "說明規則", "editable": True, "custom_fields": {}},
                {"page_number": 3, "kind": "content", "title": "水的城市旅行", "communication_goal": "解釋系統", "key_message": "水會流經多個相互連結的環節", "content_elements": ["概念圖"], "metric_ids": [], "formula_ids": ["f1"], "chart_ids": ["c1"], "insight_ids": [], "custom_requirement_ids": [], "evidence_requirements": ["公開科普來源"], "layout_guidance": "全頁概念地圖", "speaker_notes_guidance": "逐步揭示", "editable": True, "custom_fields": {}},
                {"page_number": 4, "kind": "content", "title": "小組排序挑戰", "communication_goal": "檢查理解", "key_message": "用排序活動找出容易混淆的環節", "content_elements": ["活動卡", "討論題"], "metric_ids": [], "formula_ids": [], "chart_ids": [], "insight_ids": ["i1"], "custom_requirement_ids": ["r1"], "evidence_requirements": ["教師觀察"], "layout_guidance": "左右分欄", "speaker_notes_guidance": "保留討論時間", "editable": True, "custom_fields": {}},
                {"page_number": 5, "kind": "back-cover", "title": "任務完成", "communication_goal": "收束與反思", "key_message": "每一滴水都在系統中旅行", "content_elements": ["反思問題"], "metric_ids": [], "formula_ids": [], "chart_ids": [], "insight_ids": [], "custom_requirement_ids": [], "evidence_requirements": [], "layout_guidance": "簡潔封底", "speaker_notes_guidance": "邀請分享", "editable": True, "custom_fields": {}},
            ],
            "unresolved_questions": ["是否需要符合特定課綱"],
            "planning_notes": ["內容由模型依完整 Prompt 產生，不使用關鍵字路由"],
            "custom_fields": {},
        },
        "custom_fields": {},
    }


class ScriptedPlanningModel(Model):
    """Test-only model fixture; production must inject an approved real model."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.seen_messages: list[list[dict[str, Any]]] = []
        self.seen_output_models: list[str] = []
        self.config: dict[str, Any] = {"model_id": "scripted-test-only"}

    def get_config(self) -> dict[str, Any]:
        return dict(self.config)

    def update_config(self, **model_config: Any) -> None:
        self.config.update(model_config)

    async def stream(self, messages: list[dict[str, Any]], tool_specs: list[dict[str, Any]] | None = None, system_prompt: str | None = None, **_: Any) -> AsyncIterable[dict[str, Any]]:
        self.seen_messages.append(messages)
        names = {spec["name"] for spec in tool_specs or []}
        if "RequirementsPlanningStageOutput" in names:
            output_name = "RequirementsPlanningStageOutput"
            output = {"prompt_contract": self.payload["prompt_contract"]}
        elif "FormulaPlanningStageOutput" in names:
            output_name = "FormulaPlanningStageOutput"
            output = {"formula_plan": self.payload["formula_plan"]}
        elif "CalculationPlanningStageOutput" in names:
            output_name = "CalculationPlanningStageOutput"
            output = {
                "calculation_plan": self.payload["calculation_plan"],
                "chart_calculation_links": [
                    {
                        "chart_id": chart["chart_id"],
                        "formula_ids": chart["formula_ids"],
                        "calculation_task_ids": chart["calculation_task_ids"],
                    }
                    for chart in self.payload["prompt_contract"]["charts"]
                ],
            }
        elif "CompositionPlanningStageOutput" in names:
            output_name = "CompositionPlanningStageOutput"
            output = {
                "presentation_generation_plan": self.payload["presentation_generation_plan"],
                "execution_plan": self.payload["execution_plan"],
                "deck_plan": self.payload["deck_plan"],
            }
        elif "PromptAlignmentValidation" in names:
            output_name = "PromptAlignmentValidation"
            output = {
                "score": 96,
                "approved": True,
                "coverage_items": [{
                    "requirement": "以互動式科普簡報向兒童解釋城市水循環",
                    "status": "covered",
                    "plan_references": ["prompt_contract.presentation_goal", "deck_plan"],
                    "rationale": "目標與逐頁內容均直接涵蓋。",
                }],
                "missing_explicit_requirements": [],
                "summary": "明確要求均有具體計畫欄位覆蓋。",
            }
        else:
            raise AssertionError(f"unexpected structured output tools: {sorted(names)}")
        self.seen_output_models.append(output_name)
        encoded = json.dumps(output, ensure_ascii=False)
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": "planning-output-1", "name": output_name}}}}
        yield {"contentBlockDelta": {"delta": {"toolUse": {"input": encoded}}}}
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}

    async def structured_output(self, *_: Any, **__: Any) -> AsyncGenerator[dict[str, Any], None]:
        raise AssertionError("adapter must use the current structured_output_model invocation API")
        if False:
            yield {}


class RepairingCalculationModel(ScriptedPlanningModel):
    """Returns one malformed calculation response, then repairs only that stage."""

    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__(payload)
        self.calculation_calls = 0

    async def stream(self, messages: list[dict[str, Any]], tool_specs: list[dict[str, Any]] | None = None, system_prompt: str | None = None, **kwargs: Any) -> AsyncIterable[dict[str, Any]]:
        names = {spec["name"] for spec in tool_specs or []}
        original_payload = self.payload
        if "CalculationPlanningStageOutput" in names:
            self.calculation_calls += 1
            if self.calculation_calls == 1:
                malformed = deepcopy(self.payload)
                malformed["calculation_plan"]["tasks"][0]["input_bindings"] = malformed["calculation_plan"]["tasks"][0]["input_bindings"][:1]
                self.payload = malformed
        try:
            async for event in super().stream(messages, tool_specs, system_prompt, **kwargs):
                yield event
        finally:
            self.payload = original_payload


def test_ai_model_owns_flexible_planning_and_validator_owns_only_invariants() -> None:
    model = ScriptedPlanningModel(planning_payload())
    adapter = StrandsLobsterRuntimeAdapter(model)
    prompt = "為兒童規劃一場完全不同於商業報告的互動式科普簡報"

    plan = adapter.plan(
        prompt,
        workbook_context=[{
            "upload_id": "upload-activity",
            "file_name": "activity.xlsx",
            "sheets": [{
                "sheet_name": "活動紀錄",
                "sample_rows": [["完成狀態", "學生編號"], ["完成", "S-001"]],
            }],
        }],
    )

    assert importlib.metadata.version("strands-agents") == "1.47.0"
    assert adapter.registered_tools == ALLOWED_TOOLS == {"validate-deck-plan"}
    assert plan.planning_output.prompt_contract.target_audience == "國小高年級學生"
    assert plan.planning_output.prompt_contract.charts[0].visualization == "互動式概念地圖"
    assert [stage.stage_class for stage in plan.planning_output.execution_plan.stages] == ["understand", "acquire", "analyze", "compose", "render-verify"]
    assert plan.validation_report.checked_slide_count == 5
    assert plan.validation_report.checked_references == 9
    assert model.seen_messages and prompt in model.seen_messages[0][-1]["content"][0]["text"]
    assert model.seen_output_models == [
        "RequirementsPlanningStageOutput",
        "FormulaPlanningStageOutput",
        "CalculationPlanningStageOutput",
        "CompositionPlanningStageOutput",
        "PromptAlignmentValidation",
    ]
    assert plan.validation_report.prompt_alignment_score == 96
    assert all(prompt not in receipt.model_dump_json() for receipt in plan.tool_receipts)


def test_calculation_retry_receives_exact_binding_delta_and_prior_output() -> None:
    model = RepairingCalculationModel(planning_payload())
    adapter = StrandsLobsterRuntimeAdapter(model)

    plan = adapter.plan(
        "為兒童規劃互動式科普簡報",
        workbook_context=[{
            "upload_id": "upload-activity",
            "file_name": "activity.xlsx",
            "sheets": [{"sheet_name": "活動紀錄", "sample_rows": [["完成狀態", "學生編號"]]}],
        }],
    )

    assert plan.validation_report.valid is True
    assert model.calculation_calls == 2
    calculation_requests = [
        messages[-1]["content"][0]["text"]
        for messages, output_name in zip(model.seen_messages, model.seen_output_models)
        if output_name == "CalculationPlanningStageOutput"
    ]
    assert "previous_calculation_stage_output" in calculation_requests[1]
    assert "missing=participants" in calculation_requests[1]


def test_calculation_missing_metric_error_names_the_required_metric() -> None:
    payload = planning_payload()
    output = CalculationPlanningStageOutput.model_validate({
        "calculation_plan": {
            "plan_version": "calculation-plan-v1",
            "generated_code_policy": payload["calculation_plan"]["generated_code_policy"],
            "tasks": [],
            "execution_order": [],
            "custom_fields": {},
        },
        "chart_calculation_links": [{
            "chart_id": "c1",
            "formula_ids": ["f1"],
            "calculation_task_ids": [],
        }],
    })

    with pytest.raises(ValueError, match="missing_metric_ids=m1"):
        StrandsLobsterRuntimeAdapter._validate_calculation_links(
            PromptContract.model_validate(payload["prompt_contract"]),
            FormulaPlan.model_validate(payload["formula_plan"]),
            output,
            [],
        )


def test_execute_resume_cancel() -> None:
    adapter = StrandsLobsterRuntimeAdapter(ScriptedPlanningModel(planning_payload()))
    plan = adapter.plan("自由分析完整 Prompt")
    manifest = adapter.execute(plan.planning_output)

    assert adapter.resume(manifest.context_version, manifest.attempt) == manifest
    assert adapter.cancel(plan.execution_id, "compose").status == "cancelled"
    with pytest.raises(LookupError):
        adapter.resume(999, 1)


def test_unknown_slide_reference_fails_closed() -> None:
    payload = planning_payload()
    payload["deck_plan"]["slides"][2]["chart_ids"] = ["unknown-chart"]
    output = AIPlanningOutput.model_validate(payload)

    with pytest.raises(ValueError, match="unknown requirement"):
        validate_planning_output(output)


def test_stage_tool_timing_is_governed_without_governing_content() -> None:
    payload = planning_payload()
    payload["execution_plan"]["stages"][2]["allowed_tool_categories"] = ["research"]

    with pytest.raises(ValidationError, match="outside its governance policy"):
        AIPlanningOutput.model_validate(payload)


def test_schema_allows_unanticipated_custom_requirements_but_rejects_unknown_fields() -> None:
    payload = planning_payload()
    payload["prompt_contract"]["custom_requirements"].append({
        "requirement_id": "r2",
        "category": "現場道具",
        "description": "每組需要一套可重複使用的卡片",
        "origin": "inferred",
        "acceptance_criteria": ["不依賴網路"],
        "custom_fields": {"material": "reusable"},
    })
    payload["deck_plan"]["slides"][3]["custom_requirement_ids"].append("r2")
    assert validate_planning_output(AIPlanningOutput.model_validate(payload)).valid is True

    payload["prompt_contract"]["hardcoded_industry"] = "finance"
    with pytest.raises(ValidationError):
        AIPlanningOutput.model_validate(payload)


def test_model_is_required_and_blank_prompt_is_rejected() -> None:
    with pytest.raises(TypeError):
        StrandsLobsterRuntimeAdapter()  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="must not be blank"):
        StrandsLobsterRuntimeAdapter(ScriptedPlanningModel(planning_payload())).plan("   ")
