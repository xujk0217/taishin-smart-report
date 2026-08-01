import { describe, expect, it } from 'vitest';
import {
  aiPlanningOutputSchema,
  createUploadRequestSchema,
  manualPlanEditRequestSchema,
  PLANNER_LIMITS,
} from './planner.js';

const sha256 = 'a'.repeat(64);

function planningOutput() {
  const slides = [
    ['cover', '封面'],
    ['content', '實際資料分析'],
    ['back-cover', '結語'],
  ].map(([kind, title], index) => ({
    page_number: index + 1,
    kind,
    title,
    communication_goal: title,
    key_message: title,
    content_elements: [title],
    metric_ids: index === 1 ? ['metric-1'] : [],
    formula_ids: index === 1 ? ['formula-1'] : [],
    chart_ids: index === 1 ? ['chart-1'] : [],
    insight_ids: [],
    custom_requirement_ids: [],
    evidence_requirements: index === 1 ? ['實際 Excel 儲存格來源'] : [],
    layout_guidance: '依範本角色與核准的圖文比例配置',
    speaker_notes_guidance: '不得加入未驗證數值',
    editable: true,
    custom_fields: {},
  }));

  return {
    output_version: 'ai-planning-output-v3',
    prompt_contract: {
      contract_version: 'prompt-contract-v3',
      user_intent: '以實際工作簿產生三頁簡報',
      presentation_goal: '說明完成率',
      target_audience: '主管',
      language: 'zh-TW',
      recommended_page_count: 3,
      page_count_origin: 'explicit',
      page_count_rationale: '使用者指定',
      tone_and_style: ['簡潔'],
      visual_direction: ['沿用範本'],
      metrics: [{
        metric_id: 'metric-1', name: '完成率', purpose: '顯示完成狀態',
        definition_needed: '完成數除以總數', calculation_required: true,
        origin: 'explicit', required: true, custom_fields: {},
      }],
      charts: [{
        chart_id: 'chart-1', title: '完成率', visualization: 'bar', purpose: '比較完成狀態',
        data_requirements: ['完成數', '總數'], formula_ids: ['formula-1'], calculation_task_ids: ['task-1'], origin: 'recommended',
        rationale: '適合比較', required: true, custom_fields: {},
      }],
      insights: [], data_requirements: ['工作簿實際欄位'], research_requirements: [],
      formula_requirements: ['完成率公式'], content_constraints: ['不得使用假資料'],
      output_requirements: ['可編輯 PPTX'], custom_requirements: [], assumptions: [], ambiguities: [],
      custom_fields: { owner_note: '可手動修改' },
    },
    formula_plan: {
      plan_version: 'formula-plan-v1', research_strategy: 'model-knowledge-only',
      formulas: [{
        formula_id: 'formula-1', name: '完成率', purpose: '計算完成比例',
        expression: 'completed / total * 100',
        variables: [
          { symbol: 'completed', definition: '完成筆數', expected_unit: '筆' },
          { symbol: 'total', definition: '總筆數', expected_unit: '筆' },
        ],
        output_unit: '%', applicability_conditions: ['total > 0'], assumptions: [],
        missing_data_policy: '停止並回報', zero_division_policy: '停止並回報',
        source_candidates: [{
          source_type: 'model-knowledge', title: '比例定義', locator: 'model-knowledge:ratio',
          rationale: '一般比例公式', verification_state: 'unverified',
        }],
        status: 'needs-user-confirmation', required: true, custom_fields: { precision: 2 },
      }],
      unresolved_questions: [], custom_fields: {},
    },
    calculation_plan: {
      plan_version: 'calculation-plan-v1',
      generated_code_policy: {
        language: 'python', allowed_libraries: ['python-standard-library', 'openpyxl'],
        network_access: false, read_only_inputs: true, forbidden_operations: ['修改來源 Excel', '執行 shell'],
      },
      tasks: [{
        task_id: 'task-1', output_metric_id: 'metric-1', formula_id: 'formula-1', objective: '計算實際完成率',
        input_bindings: [
          { variable: 'completed', workbook_upload_id: 'upload-1', workbook_selector: 'input.xlsx', sheet_selector: '資料', column_selector: '狀態', cell_range_hint: '', aggregation: 'count completed', required: true },
          { variable: 'total', workbook_upload_id: 'upload-1', workbook_selector: 'input.xlsx', sheet_selector: '資料', column_selector: '編號', cell_range_hint: '', aggregation: 'count rows', required: true },
        ],
        output_fields: ['value', 'unit', 'source_refs', 'calculation_steps'],
        code_generation_instructions: ['使用 openpyxl read_only/data_only'], validation_checks: ['0 <= value <= 100'],
        provenance_requirements: ['保存 workbook/sheet/column/range'], custom_fields: {},
      }],
      execution_order: ['task-1'], custom_fields: {},
    },
    presentation_generation_plan: {
      plan_version: 'presentation-generation-plan-v1',
      template_analysis: {
        template_required: true, classification_rules: ['檢查 master、placeholder 與版面結構'],
        required_slide_roles: ['cover', 'content', 'back-cover'], inspect_master_layouts: true,
        inspect_placeholders: true, inspect_theme_and_dimensions: true, preserve_unmodified_template_objects: true,
      },
      python_generation: {
        language: 'python', primary_library: 'python-pptx', generation_steps: ['分析範本', '依 DeckPlan 生成'],
        editable_object_requirements: ['圖表與文字保持可編輯'], fidelity_checks: ['頁數與內容符合核准計畫'],
      },
      layout_consistency_rules: ['維持核准的圖表與文字比例'],
      preview_editing: {
        manual_editable_fields: ['title', 'text', 'chart', 'page_count'], natural_language_editing: true,
        revision_behavior: ['修改後重新驗證並重新生成'],
      },
      provenance_display: {
        required_fields: ['workbook', 'sheet', 'columns', 'cell_range', 'formula', 'calculation_steps', 'result', 'unit'],
        show_per_chart: true, show_only_actual_data: true,
      },
      final_export_requirements: ['輸出可編輯 PPTX', '不得使用 synthetic 資料'], custom_fields: {},
    },
    execution_plan: {
      stages: [
        ['understand', ['contract']],
        ['acquire', ['data-read', 'research']],
        ['analyze', ['calculation', 'analysis']],
        ['compose', ['deck-planning']],
        ['render-verify', ['rendering', 'inspection']],
      ].map(([stage_class, allowed_tool_categories], index) => ({
        stage_id: `stage-${index + 1}`, stage_class, objective: String(stage_class),
        planned_activities: ['依 Prompt 動態規劃'], required_inputs: ['前階段輸出'],
        allowed_tool_categories, required_outputs: ['版本化輸出'], validation_checks: ['schema'],
        completion_criteria: ['驗證通過'], requires_user_approval: index === 0 || index === 4,
      })),
    },
    deck_plan: {
      plan_version: 'deck-plan-v3', title: '完成率簡報', subtitle: '', total_pages: 3,
      narrative_strategy: '結論先行', narrative_arc: ['目的', '結果', '結語'], slides,
      unresolved_questions: [], planning_notes: ['只使用實際資料'], custom_fields: {},
    },
    custom_fields: { review_mode: 'manual-or-natural-language' },
  };
}

describe('real planner v3 contracts', () => {
  it('accepts up to twenty Excel files and rejects the twenty-first', () => {
    const files = Array.from({ length: PLANNER_LIMITS.maxFiles }, (_, index) => ({
      fileName: `input-${index + 1}.xlsx`, sizeBytes: 1, sha256,
    }));
    expect(createUploadRequestSchema.parse({ files }).files).toHaveLength(20);
    expect(() => createUploadRequestSchema.parse({ files: [...files, files[0]] })).toThrow();
  });

  it('validates formula, deterministic calculation, PPT generation, and full manual edits', () => {
    const output = aiPlanningOutputSchema.parse(planningOutput());
    const edit = manualPlanEditRequestSchema.parse({
      expectedPlanVersion: 1,
      editSummary: '手動調整公式精度與簡報規格',
      planningOutput: output,
    });
    expect(edit.planningOutput.formula_plan.formulas[0].custom_fields.precision).toBe(2);
    expect(edit.planningOutput.presentation_generation_plan.python_generation.primary_library).toBe('python-pptx');
  });

  it('fails closed when generated-code bindings do not match the formula', () => {
    const output = planningOutput();
    output.calculation_plan.tasks[0].input_bindings.pop();
    expect(() => aiPlanningOutputSchema.parse(output)).toThrow(/bindings/i);
  });
});
