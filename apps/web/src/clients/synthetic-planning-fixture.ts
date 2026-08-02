import type { DeckPlan, FiveStageExecutionPlan, PromptContract } from '../types/job';

/**
 * UI-only fixture. It never interprets the prompt and must not be used as an AI fallback.
 * The real API will replace this fixture with the schema-bound Strands planning output.
 */
export function createSyntheticPlanningFixture(userIntent: string): {
  promptContract: PromptContract;
  executionPlan: FiveStageExecutionPlan;
  deckPlan: DeckPlan;
} {
  const promptContract: PromptContract = {
    contractVersion: 'prompt-contract-v2',
    userIntent,
    presentationGoal: '待 AI Planner 依完整 Prompt 判斷',
    targetAudience: '待 AI Planner 判斷',
    language: '待 AI Planner 判斷',
    recommendedPageCount: 5,
    pageCountOrigin: 'recommended',
    pageCountRationale: '此數字只用於展示逐頁 UI；不是對 Prompt 的分析結果',
    toneAndStyle: ['待 AI Planner 判斷'],
    visualDirection: ['待 AI Planner 判斷'],
    metrics: [],
    charts: [{
      chartId: 'chart-pending',
      title: '圖表需求待 AI 判斷',
      visualization: '未決定',
      purpose: '展示未來 AI 輸出的圖表規格位置',
      dataRequirements: [],
      origin: 'recommended',
      rationale: 'UI synthetic placeholder；未分析 Prompt',
      required: false,
    }],
    insights: [{
      insightId: 'insight-pending',
      question: '洞察問題待 AI 根據完整 Prompt 定義',
      purpose: '展示未來 AI 輸出的洞察規格位置',
      evidenceNeeded: [],
      origin: 'recommended',
      required: false,
    }],
    dataRequirements: ['待 AI Planner 判斷'],
    researchRequirements: ['待 AI Planner 判斷是否需要研究'],
    formulaRequirements: ['待 AI Planner 判斷是否需要公式'],
    contentConstraints: ['不得將此 synthetic fixture 表示為 AI 分析結果', '不得捏造數值、洞察或來源'],
    outputRequirements: ['原生可編輯簡報規格', '引用與驗證狀態可追溯'],
    customRequirements: [],
    assumptions: [],
    ambiguities: ['Real AI Planner API 尚未啟用'],
  };

  const executionPlan: FiveStageExecutionPlan = {
    stages: [
      {
        stageId: 'understand', stageClass: 'understand', objective: '由 AI 理解完整 Prompt 並建立需求契約',
        plannedActivities: ['辨識明示與隱含要求', '提出需要使用者確認的歧義'], requiredInputs: ['完整 Prompt'],
        allowedToolCategories: ['contract'], requiredOutputs: ['PromptContract'], validationChecks: ['需求覆蓋與 schema 驗證'],
        completionCriteria: ['PromptContract 完整且歧義可見'], requiresUserApproval: true,
      },
      {
        stageId: 'acquire', stageClass: 'acquire', objective: '依核准計畫取得允許的資料與公開研究',
        plannedActivities: ['AI 決定需要哪些資料', '透過受控 Research Broker 取得公開來源'], requiredInputs: ['已核准 PromptContract'],
        allowedToolCategories: ['data-read', 'research'], requiredOutputs: ['來源與引用紀錄'], validationChecks: ['來源、權限與資料完整性驗證'],
        completionCriteria: ['必要資料可追溯或明確標示缺口'], requiresUserApproval: false,
      },
      {
        stageId: 'analyze', stageClass: 'analyze', objective: '依證據計算指標並形成可驗證洞察',
        plannedActivities: ['AI 選擇分析方法', 'deterministic tools 執行核准公式'], requiredInputs: ['已驗證資料與來源'],
        allowedToolCategories: ['calculation', 'analysis'], requiredOutputs: ['證據、計算紀錄與洞察候選'], validationChecks: ['公式適用性、單位、數值與引用驗證'],
        completionCriteria: ['每項洞察都有接受的證據'], requiresUserApproval: false,
      },
      {
        stageId: 'compose', stageClass: 'compose', objective: '由 AI 規劃敘事、圖表與每一頁內容',
        plannedActivities: ['決定頁數與風格', '建立逐頁 DeckPlan'], requiredInputs: ['PromptContract 與已接受證據'],
        allowedToolCategories: ['deck-planning'], requiredOutputs: ['DeckPlan'], validationChecks: ['Prompt 覆蓋、頁面與引用一致性驗證'],
        completionCriteria: ['逐頁計畫完整且可供使用者編輯'], requiresUserApproval: true,
      },
      {
        stageId: 'render-verify', stageClass: 'render-verify', objective: '產生原生可編輯產物並獨立檢查',
        plannedActivities: ['渲染簡報', '檢查圖表、文字、來源與 artifact hash'], requiredInputs: ['已核准 DeckPlan'],
        allowedToolCategories: ['rendering', 'inspection'], requiredOutputs: ['PPTX、預覽與 inspection report'], validationChecks: ['物件完整性、引用、版面與 hash 驗證'],
        completionCriteria: ['檢查通過且最終核准綁定 artifact hash'], requiresUserApproval: true,
      },
    ],
  };

  const slide = (
    pageNumber: number,
    kind: 'cover' | 'content' | 'back-cover',
    title: string,
    communicationGoal: string,
  ) => ({
    pageNumber,
    kind,
    title,
    communicationGoal,
    keyMessage: '待 AI Planner 根據完整 Prompt 與證據產生',
    contentElements: ['Synthetic UI placeholder'],
    metricIds: [],
    chartIds: [],
    insightIds: [],
    customRequirementIds: [],
    evidenceRequirements: [],
    layoutGuidance: '待 AI Planner 決定',
    speakerNotesGuidance: '不得填入未驗證內容',
    editable: true,
  });

  const deckPlan: DeckPlan = {
    planVersion: 'deck-plan-v2',
    title: 'AI 逐頁計畫預覽位置',
    subtitle: '目前只展示資料結構，沒有分析 Prompt',
    totalPages: 5,
    narrativeStrategy: '待 AI Planner 根據完整 Prompt 自主決定',
    narrativeArc: ['理解任務', '取得與驗證證據', '組織敘事與行動'],
    slides: [
      slide(1, 'cover', '封面（待 AI 規劃）', '建立主題與閱讀期待'),
      slide(2, 'content', '內容頁（待 AI 規劃）', '呈現 AI 選擇的資訊或證據'),
      slide(3, 'content', '視覺頁（待 AI 規劃）', '呈現 AI 選擇的圖表或其他視覺形式'),
      slide(4, 'content', '洞察頁（待 AI 規劃）', '呈現有證據支持的洞察與行動'),
      slide(5, 'back-cover', '封底（待 AI 規劃）', '收束簡報'),
    ],
    unresolvedQuestions: ['Real AI Planner API 尚未啟用，無法產生針對此 Prompt 的問題'],
    planningNotes: ['這是非推論 synthetic fixture，不是 AI 分析結果，也不會作為 real failure fallback'],
  };

  return { promptContract, executionPlan, deckPlan };
}
