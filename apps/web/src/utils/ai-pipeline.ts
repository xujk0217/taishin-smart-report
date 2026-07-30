/**
 * AI Pipeline — multi-step structured analysis flow.
 *
 * Step 1: Audience & Context (簡報對象、目的、語氣)
 * Step 2: Metrics Discovery (指標探索、公式定義)
 * Step 3: Insights per Topic (策略洞察、分析觀點)
 * Step 4: Slide Spec (結合上述產出完整簡報規格)
 *
 * Each step runs AI generation → AI validation → proceed.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';

const API_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

// ─── Types ───────────────────────────────────────────────────

export interface AudienceContext {
  audience: string;         // 報告對象（如：信用卡事業部主管）
  purpose: string;          // 報告目的
  tone: string;             // 語氣（如：正式策略型、數據驅動型）
  focusAreas: string[];     // 著重分析的面向
  depth: 'executive' | 'detailed' | 'technical';
}

export interface MetricSpec {
  id: string;
  name: string;
  definition: string;
  category: string;         // 市占率/成長率/規模/效率
  supported: boolean;
  reason?: string;
  relevanceToAudience: string;  // 為什麼這個指標對報告對象重要
}

export interface TopicInsight {
  topic: string;            // 主題名稱
  keyFinding: string;       // 一句話核心發現
  dataPoints: string[];     // 支撐的數據點
  implication: string;      // 對台新的意涵
  recommendation: string;   // 建議行動
  chartSuggestion?: string; // 建議用什麼圖表呈現
}

export interface PipelineResult {
  audience: AudienceContext;
  metrics: MetricSpec[];
  insights: TopicInsight[];
  unsupported: { name: string; reason: string }[];
  suggestedSlides: string[];
}

// ─── Helper ──────────────────────────────────────────────────

async function aiCall(system: string, user: string, maxTokens = 6000): Promise<string> {
  const data = await callGroqWithRetry(API_KEY, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.25,
    max_tokens: maxTokens,
  });
  return extractContent(data);
}

function parseJSON<T>(text: string): T | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}') + 1;
  if (s >= 0 && e > s) cleaned = cleaned.slice(s, e);
  try { return JSON.parse(cleaned); } catch { return null; }
}

// ─── Step 1: Audience & Context ──────────────────────────────

const AUDIENCE_SYSTEM = `你是台新新光金控的策略顧問。分析使用者的需求，判斷：
1. 這份報告要給誰看（簡報對象）
2. 報告的目的是什麼
3. 應該用什麼語氣和深度
4. 重點分析面向有哪些

如果使用者沒有明確指定對象，根據內容推斷最合適的對象。

回傳 JSON：
{
  "audience": "信用卡事業部副總經理",
  "purpose": "114年度信用卡市場表現回顧與策略規劃",
  "tone": "正式策略報告，數據驅動，著重競爭定位與行動建議",
  "focusAreas": ["市占率變化趨勢", "競爭者動態", "成長機會"],
  "depth": "executive"
}

depth 選項：
- "executive": 高階主管（重洞察和建議，少細節）
- "detailed": 部門主管（數據+洞察+建議）
- "technical": 分析師（完整數據、方法論、假設）

只回傳 JSON。`;

export async function analyzeAudience(prompt: string, excelSummary: string): Promise<AudienceContext> {
  const result = await aiCall(
    AUDIENCE_SYSTEM,
    `使用者的需求：\n${prompt}\n\n資料概要：\n${excelSummary}\n\n請分析報告對象和重點。`,
  );

  const parsed = parseJSON<AudienceContext>(result);
  if (!parsed) {
    return {
      audience: '信用卡事業部主管',
      purpose: '信用卡市場分析報告',
      tone: '正式策略報告',
      focusAreas: ['市占率', '排名', '成長率'],
      depth: 'detailed',
    };
  }

  // Validation pass
  try {
    const valResult = await aiCall(
      `檢查以下情境分析是否合理。如果有問題就修正回傳，正確就原樣回傳。只回傳 JSON。`,
      `原始需求：${prompt}\n\n情境分析結果：${JSON.stringify(parsed)}\n\n問題：
1. audience 是否合理？
2. focusAreas 是否涵蓋使用者提到的所有分析重點？
3. depth 是否適合目標受眾？`,
      3000,
    );
    const validated = parseJSON<AudienceContext>(valResult);
    if (validated?.audience) return validated;
  } catch { /* use original */ }

  return parsed;
}

// ─── Step 2: Metrics Discovery (3-pass: extract → map → verify) ─

const EXTRACT_REQUESTS_SYSTEM = `你是文字分析工具。從使用者的需求文字中，精確提取出所有他想要分析的指標名稱。

規則：
1. 列出每一個使用者明確提到或暗示的分析指標
2. 如果使用者用數字編號列了清單，每一項都要提取
3. 不要遺漏，不要合併，逐項列出
4. 只提取指標名稱，不要加解釋

回傳格式（JSON array）：
{"requestedMetrics": ["簽帳金額市占率", "流通卡數市占率", "月增率"]}
注意：必須列出所有指標，不可用省略號。只回傳 JSON。`;

const MAP_METRICS_SYSTEM = `你是金融數據分析專家。以下是使用者要求的指標清單，以及可用的 Excel 欄位。
你必須逐項回答每一個指標是否可以計算。

可用 Excel 欄位（每月一份，114年1-12月）：
- 金融機構名稱（約34家銀行 + 總計）
- 流通卡數（張）
- 有效卡數（張）
- 當月發卡數（張）
- 當月停卡數（張）
- 循環信用餘額（千元）
- 未到期分期付款餘額（千元）
- 當月簽帳金額（千元）
- 當月預借現金金額（千元）
- 逾期三個月以上帳款占應收帳款餘額比率(%)
- 逾期六個月以上帳款占應收帳款餘額比率(%)
- 備抵呆帳提足率(%)
- 當月轉銷呆帳金額（千元）
- 當年度轉銷呆帳金額累計至資料月份（千元）

可以計算的公式類型：
- 市占率 = 個別銀行值 / 總計值 × 100%
- 月增率(MoM) = (本月 - 上月) / 上月 × 100%
- 排名 = 按數值大小排序
- 比率 = 已有的比率欄位直接使用
- 有效卡率 = 有效卡數 / 流通卡數 × 100%
- 停卡率 = 當月停卡數 / 流通卡數 × 100%
- 單卡消費力 = 當月簽帳金額 / 有效卡數
- 不能計算的：年增率(YoY)因為沒有113年資料

你必須對使用者要求的「每一個」指標都給出回答，不可跳過任何一個。

回傳 JSON：
{
  "metrics": [
    {"id":"m1","name":"指標名稱","definition":"計算公式","category":"分類","supported":true,"relevanceToAudience":"重要性說明"}
  ],
  "unsupported": [
    {"name":"指標名稱","reason":"無法計算的原因"}
  ]
}
只回傳 JSON。`;

export async function discoverMetrics(
  prompt: string,
  excelSummary: string,
  audience: AudienceContext,
): Promise<{ metrics: MetricSpec[]; unsupported: { name: string; reason: string }[] }> {

  // Pass 1: Extract what user actually asked for
  const extractResult = await aiCall(
    EXTRACT_REQUESTS_SYSTEM,
    `使用者的完整需求文字：\n${prompt}`,
    2000,
  );
  const extracted = parseJSON<{ requestedMetrics: string[] }>(extractResult);
  const requestedMetrics = extracted?.requestedMetrics ?? [];
  console.log('[Metrics] Extracted user requests:', requestedMetrics);

  // Pass 2: Map each requested metric to data
  const mapResult = await aiCall(
    MAP_METRICS_SYSTEM,
    `報告對象：${audience.audience}
報告目的：${audience.purpose}
重點面向：${audience.focusAreas.join('、')}

使用者明確要求的指標（必須逐項回答）：
${requestedMetrics.map((m, i) => `${i + 1}. ${m}`).join('\n')}

${requestedMetrics.length === 0 ? `使用者原始需求：${prompt}\n\n請根據需求推導出所有應該分析的指標。` : ''}

請對上面每一個指標都給出是否可計算的回答。如果可以，寫出公式。如果不行，說明原因。`,
    8000,
  );

  const mapped = parseJSON<{ metrics: MetricSpec[]; unsupported: any[] }>(mapResult);
  if (!mapped?.metrics) {
    return { metrics: [], unsupported: [] };
  }

  // Pass 3: Verify completeness — retry if coverage is too low
  const coveredNames = [...mapped.metrics.map(m => m.name), ...(mapped.unsupported?.map(u => u.name) ?? [])];
  const missing = requestedMetrics.filter(req =>
    !coveredNames.some(name => name.includes(req) || req.includes(name))
  );

  if (missing.length > 0 && missing.length <= requestedMetrics.length * 0.5) {
    console.log('[Metrics] Missing metrics, running补充 pass:', missing);
    try {
      const supplementResult = await aiCall(
        MAP_METRICS_SYSTEM,
        `以下指標在上一輪被遺漏了，請逐項補充回答：
${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}

已有的指標（不要重複）：${mapped.metrics.map(m => m.name).join('、')}`,
        4000,
      );
      const supplement = parseJSON<{ metrics: MetricSpec[]; unsupported: any[] }>(supplementResult);
      if (supplement?.metrics) {
        // Merge, deduplicate by name
        const existingNames = new Set(mapped.metrics.map(m => m.name));
        for (const m of supplement.metrics) {
          if (!existingNames.has(m.name)) {
            mapped.metrics.push({ ...m, id: `m${mapped.metrics.length + 1}` });
            existingNames.add(m.name);
          }
        }
        if (supplement.unsupported) {
          mapped.unsupported = [...(mapped.unsupported ?? []), ...supplement.unsupported];
        }
      }
    } catch { /* proceed with what we have */ }
  }

  // Ensure IDs are sequential
  mapped.metrics = mapped.metrics.map((m, i) => ({ ...m, id: `m${i + 1}` }));

  console.log(`[Metrics] Final: ${mapped.metrics.length} supported, ${mapped.unsupported?.length ?? 0} unsupported`);
  return { metrics: mapped.metrics, unsupported: mapped.unsupported ?? [] };
}

// ─── Step 3: Insights per Topic ──────────────────────────────

const INSIGHTS_SYSTEM = `你是麥肯錫等級的策略顧問。根據數據摘要和指標，為每個分析主題產生策略洞察。

每個洞察要包含：
1. topic: 主題名稱
2. keyFinding: 一句話核心發現（像新聞標題一樣有力）
3. dataPoints: 支撐這個發現的 2-4 個數據點（必須來自提供的數據）
4. implication: 對台新銀行的策略意涵（So What?）
5. recommendation: 具體的建議行動（Now What?）
6. chartSuggestion: 建議用什麼圖表呈現（line/bar/kpi/comparison/table）

規則：
- 洞察要有深度，不能只是複述數字
- 要從數據中找出趨勢、異常、機會、威脅
- 建議要具體可行，不能是空泛的口號
- 每個 focusArea 至少對應 1-2 個洞察

回傳 JSON：
{"insights":[{"topic":"...","keyFinding":"...","dataPoints":["..."],"implication":"...","recommendation":"...","chartSuggestion":"line"}]}

只回傳 JSON。`;

export async function generateInsights(
  prompt: string,
  dataSummary: string,
  audience: AudienceContext,
  metrics: MetricSpec[],
): Promise<TopicInsight[]> {
  const result = await aiCall(
    INSIGHTS_SYSTEM,
    `報告對象：${audience.audience}
報告目的：${audience.purpose}
語氣：${audience.tone}
重點面向：${audience.focusAreas.join('、')}

可用指標：
${metrics.filter(m => m.supported).map(m => `• ${m.name}（${m.category}）: ${m.definition}`).join('\n')}

數據摘要：
${dataSummary}

使用者特別要求的分析方向：${prompt}

請為每個重點面向產生 1-2 個策略洞察（共 ${audience.focusAreas.length * 2} 個左右）。`,
    8000,
  );

  const parsed = parseJSON<{ insights: TopicInsight[] }>(result);
  if (!parsed?.insights?.length) return [];

  // Validation: are insights grounded in data?
  try {
    const valResult = await aiCall(
      `你是資料正確性審核員。檢查以下洞察：
1. dataPoints 中的數字是否與提供的數據一致？
2. 每個 focusArea 是否都有對應的洞察？
3. recommendation 是否具體可行？
如果有問題修正後回傳，正確就原樣回傳。只回傳 JSON。`,
      `重點面向：${audience.focusAreas.join('、')}
數據摘要：${dataSummary}
洞察結果：${JSON.stringify(parsed.insights, null, 1)}`,
      8000,
    );
    const validated = parseJSON<{ insights: TopicInsight[] }>(valResult);
    if (validated?.insights?.length) return validated.insights;
  } catch { /* use original */ }

  return parsed.insights;
}

// ─── Full Pipeline ───────────────────────────────────────────

export interface PipelineProgress {
  step: number;
  total: number;
  label: string;
  detail?: string;
}

/**
 * Run the full 3-step AI pipeline.
 * onProgress is called at each step transition.
 */
export async function runAIPipeline(
  prompt: string,
  excelSummary: string,
  dataSummary: string,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  onProgress?.({ step: 1, total: 3, label: '分析簡報對象與報告方向' });

  // Step 1: Audience
  const audience = await analyzeAudience(prompt, excelSummary);
  onProgress?.({
    step: 1, total: 3, label: '分析簡報對象與報告方向',
    detail: `對象：${audience.audience}｜重點：${audience.focusAreas.slice(0, 3).join('、')}`,
  });

  // Step 2: Metrics
  onProgress?.({ step: 2, total: 3, label: '探索與驗證分析指標' });
  const { metrics, unsupported } = await discoverMetrics(prompt, excelSummary, audience);
  onProgress?.({
    step: 2, total: 3, label: '探索與驗證分析指標',
    detail: `找到 ${metrics.filter(m => m.supported).length} 個可計算指標，${unsupported.length} 個不可行`,
  });

  // Step 3: Insights
  onProgress?.({ step: 3, total: 3, label: '生成策略洞察與建議' });
  const insights = await generateInsights(prompt, dataSummary, audience, metrics);
  onProgress?.({
    step: 3, total: 3, label: '生成策略洞察與建議',
    detail: `${insights.length} 個主題洞察，涵蓋 ${[...new Set(insights.map(i => i.topic))].length} 個面向`,
  });

  // Build suggested slides from insights
  const suggestedSlides = [
    `封面：${audience.purpose}`,
    '目錄',
    ...insights.flatMap(insight => [
      `段落標題：${insight.topic}`,
      `${insight.topic} — 數據分析（${insight.chartSuggestion ?? 'chart'}）`,
      ...(insight.recommendation ? [`${insight.topic} — 洞察與建議`] : []),
    ]),
    '結論與策略建議',
    '封底',
  ];

  return {
    audience,
    metrics,
    insights,
    unsupported,
    suggestedSlides,
  };
}
