/**
 * AI Pipeline — multi-step structured analysis flow.
 *
 * Step 1: Brief    — 報告對象、目的、頁數要求、設計方向
 * Step 2: Metrics  — 指標探索（提取 → 對應 → 補齊）
 * Step 3: Insights — 每個主題的策略洞察
 * Step 4: Blueprint— 簡報架構設計（逐頁內容規劃）
 *
 * Every step generates, then validates, then proceeds.
 *
 * IMPORTANT: JSON examples in prompts must always contain realistic filled-in
 * values. Reasoning models copy literal placeholders like "..." straight into
 * their output, which produced empty decks in earlier versions.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';

const API_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

// ─── Types ───────────────────────────────────────────────────

export interface AudienceContext {
  audience: string;
  purpose: string;
  tone: string;
  focusAreas: string[];
  depth: 'executive' | 'detailed' | 'technical';
  /** Page count the user explicitly asked for; null when unspecified. */
  requestedPageCount: number | null;
  /** Layout, colour, and visual-style requests taken from the prompt. */
  designDirectives: string[];
  /** Wording, length, and person requests for the narrative text. */
  narrativeStyle: string[];
  /** Preferred chart types mentioned in the prompt. */
  chartPreferences: string[];
  /** Hard constraints, e.g. no forecasting, must cite sources. */
  constraints: string[];
}

export interface MetricSpec {
  id: string;
  name: string;
  definition: string;
  category: string;
  supported: boolean;
  reason?: string;
  relevanceToAudience: string;
}

export interface TopicInsight {
  topic: string;
  keyFinding: string;
  dataPoints: string[];
  implication: string;
  recommendation: string;
  chartSuggestion?: string;
}

export interface BlueprintPage {
  pageTitle: string;
  layout: 'cover' | 'toc' | 'section_title' | 'content' | 'backcover';
  message: string;
  elements: string[];
  metricIds?: string[];
  insightTopics?: string[];
}

export interface SlideArchitecture {
  totalPages: number;
  narrative: string;
  sections: {
    title: string;
    purpose: string;
    pages: BlueprintPage[];
  }[];
}

export interface PipelineResult {
  audience: AudienceContext;
  metrics: MetricSpec[];
  insights: TopicInsight[];
  architecture: SlideArchitecture;
  unsupported: { name: string; reason: string }[];
  suggestedSlides: string[];
}

// ─── Placeholder detection ───────────────────────────────────

/**
 * Reasoning models sometimes echo the schema instead of filling it in.
 * Any string that is only dots, or a generic label like "標題", means the
 * response is unusable and the call has to be retried.
 */
const PLACEHOLDER_RE = /^[.．。…\s]*$|^(標題|名稱|主題|內容|說明|文字|string|text|title|name|topic)$/i;

function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && (value.trim() === '' || PLACEHOLDER_RE.test(value.trim()));
}

/** Walks an object and reports how many leaf strings look like placeholders. */
function countPlaceholders(value: unknown): { total: number; bad: number } {
  let total = 0;
  let bad = 0;
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      total++;
      if (isPlaceholder(v)) bad++;
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return { total, bad };
}

/** True when enough of the response is placeholder text to be worthless. */
function looksUnfilled(value: unknown): boolean {
  const { total, bad } = countPlaceholders(value);
  if (total === 0) return true;
  return bad / total > 0.25;
}

// ─── AI call helper ──────────────────────────────────────────

function parseJSON<T>(text: string): T | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
  }
  const s = cleaned.indexOf('{');
  if (s < 0) return null;
  cleaned = cleaned.slice(s);

  const e = cleaned.lastIndexOf('}') + 1;
  if (e > 0) {
    try { return JSON.parse(cleaned.slice(0, e)) as T; } catch { /* fall through */ }
  }

  // The response was cut off mid-object. Close the open brackets so the
  // objects that did complete can still be used.
  return repairTruncatedJSON<T>(cleaned);
}

/**
 * Closes unbalanced brackets on a truncated JSON string, dropping the final
 * incomplete element. Lets a cut-off array of insights still yield results.
 */
function repairTruncatedJSON<T>(text: string): T | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      // Depth 2 means we just finished an element inside the top-level array.
      if (stack.length <= 2) lastSafe = i;
    }
  }

  if (lastSafe < 0) return null;

  let candidate = text.slice(0, lastSafe + 1);
  // Re-derive what is still open after truncating to the last complete element.
  const open: string[] = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') open.push(ch);
    else if (ch === '}' || ch === ']') open.pop();
  }

  while (open.length > 0) {
    candidate += open.pop() === '{' ? '}' : ']';
  }

  try {
    const parsed = JSON.parse(candidate) as T;
    console.warn('[Pipeline] recovered truncated JSON response');
    return parsed;
  } catch {
    return null;
  }
}

const NO_PLACEHOLDER_RULE = `
【絕對規則】
- 每一個欄位都必須填入真實、具體的內容
- 嚴禁輸出「...」、「等等」、空字串，或把欄位名稱當成值
- 嚴禁照抄範例中的示意文字
- 所有數字必須來自提供的數據，不可自行編造
- 只輸出 JSON，前後不要有任何說明文字或 markdown 標記`;

/**
 * Calls the model and retries when the response is missing, unparseable, or
 * filled with schema placeholders.
 */
async function aiJSON<T>(
  system: string,
  user: string,
  maxTokens: number,
  label: string,
): Promise<T | null> {
  let lastParsed: T | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const nudge = attempt === 0
      ? user
      : `${user}\n\n【重試提醒】上一次回覆含有未填寫的欄位或「...」。請重新輸出，每個欄位都要有具體內容。`;

    try {
      const data = await callGroqWithRetry(API_KEY, {
        messages: [
          { role: 'system', content: `${system}\n${NO_PLACEHOLDER_RULE}` },
          { role: 'user', content: nudge },
        ],
        temperature: attempt === 0 ? 0.25 : 0.45,
        max_tokens: maxTokens,
      });

      const parsed = parseJSON<T>(extractContent(data));
      if (!parsed) throw new Error('unparseable JSON');

      if (looksUnfilled(parsed)) {
        console.warn(`[Pipeline:${label}] attempt ${attempt + 1} returned placeholders, retrying`);
        lastParsed = parsed;
        continue;
      }

      return parsed;
    } catch (err: any) {
      console.warn(`[Pipeline:${label}] attempt ${attempt + 1} failed: ${err?.message}`);
      if (attempt === 2) {
        if (lastParsed) return lastParsed;
        throw err;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return lastParsed;
}

// ─── Step 1: Brief ───────────────────────────────────────────

const BRIEF_SYSTEM = `你是台新新光金控的策略顧問，負責解讀使用者的簡報需求。

你要從需求文字中判斷：
1. audience — 這份報告要給誰看。使用者沒說就依內容推斷最合理的對象
2. purpose — 報告要達成什麼目的
3. tone — 語氣風格
4. focusAreas — 要分析的面向，逐項列出
5. depth — "executive"（高階主管，重洞察輕細節）／"detailed"（部門主管，數據+洞察+建議）／"technical"（分析師，含方法論與假設）
6. requestedPageCount — 使用者明確要求的頁數。例如「做 20 頁」就填 20。沒有提到就填 null，不可自行猜測
7. designDirectives — 使用者對版面、配色、視覺風格的要求
8. narrativeStyle — 使用者對文字敘述的要求，例如用詞、句子長度、要不要口語
9. chartPreferences — 使用者偏好的圖表型態
10. constraints — 必須遵守的限制，例如不做預測、必須標註來源

第 7 到 10 項若使用者沒提到，就給空陣列或 null，不要編造。

輸出範例（這是格式示範，內容要換成你的判斷）：
{
  "audience": "信用卡事業部副總經理",
  "purpose": "回顧 114 年度信用卡市場表現並提出下年度競爭策略",
  "tone": "正式策略報告，以數據支撐論點，強調競爭定位與可執行建議",
  "focusAreas": ["簽帳金額市占率趨勢", "前五大銀行競爭態勢", "有效卡率與消費力"],
  "depth": "executive",
  "requestedPageCount": 20,
  "designDirectives": ["延續台新品牌紅色系", "每頁最多一張主圖表"],
  "narrativeStyle": ["每頁結論先行", "避免專業術語堆疊"],
  "chartPreferences": ["趨勢用折線圖", "排名用橫向柱狀圖"],
  "constraints": ["不做未來預測", "每頁標註資料來源"]
}`;

export async function analyzeAudience(
  prompt: string,
  excelSummary: string,
): Promise<AudienceContext> {
  const parsed = await aiJSON<Partial<AudienceContext>>(
    BRIEF_SYSTEM,
    `使用者的需求原文：\n${prompt}\n\n可用資料概要：\n${excelSummary}\n\n請解讀這份需求。`,
    8000,
    'brief',
  );

  const fallback: AudienceContext = {
    audience: '信用卡事業部主管',
    purpose: '信用卡市場分析報告',
    tone: '正式策略報告',
    focusAreas: ['市占率', '排名', '月增率'],
    depth: 'detailed',
    requestedPageCount: null,
    designDirectives: [],
    narrativeStyle: [],
    chartPreferences: [],
    constraints: [],
  };

  if (!parsed?.audience) return fallback;

  // The model sometimes writes a range or text; keep only a clean integer.
  const rawCount = parsed.requestedPageCount as unknown;
  let pageCount: number | null = null;
  if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
    pageCount = Math.round(rawCount);
  } else if (typeof rawCount === 'string') {
    const n = parseInt(rawCount, 10);
    if (Number.isFinite(n)) pageCount = n;
  }
  if (pageCount != null && (pageCount < 3 || pageCount > 60)) pageCount = null;

  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter(x => typeof x === 'string' && !isPlaceholder(x)) : [];

  return {
    audience: parsed.audience,
    purpose: parsed.purpose || fallback.purpose,
    tone: parsed.tone || fallback.tone,
    focusAreas: asList(parsed.focusAreas).length ? asList(parsed.focusAreas) : fallback.focusAreas,
    depth: (parsed.depth as AudienceContext['depth']) || 'detailed',
    requestedPageCount: pageCount,
    designDirectives: asList(parsed.designDirectives),
    narrativeStyle: asList(parsed.narrativeStyle),
    chartPreferences: asList(parsed.chartPreferences),
    constraints: asList(parsed.constraints),
  };
}

// ─── Step 2: Metrics ─────────────────────────────────────────

const EXTRACT_SYSTEM = `你是需求解析工具。從使用者的需求文字中，把所有想分析的指標名稱逐項抓出來。

規則：
- 使用者用編號列出的每一項都要抓
- 同一個概念用不同說法提到，分別列出
- 只寫指標名稱，不要加解釋
- 全部列完，不可用省略號

輸出範例（格式示範）：
{"requestedMetrics": ["簽帳金額市占率", "流通卡數市占率", "有效卡率", "簽帳金額月增率", "單卡平均消費力"]}`;

const AVAILABLE_COLUMNS = `可用 Excel 欄位（每月一份檔案，114年1月至12月）：
- 金融機構名稱（約 34 家銀行，另有「總計」列）
- 流通卡數（張）
- 有效卡數（張）
- 當月發卡數（張）
- 當月停卡數（張）
- 循環信用餘額（千元）
- 未到期分期付款餘額（千元）
- 當月簽帳金額（千元）
- 當月預借現金金額（千元）
- 逾期三個月以上帳款占應收帳款餘額比率（%）
- 逾期六個月以上帳款占應收帳款餘額比率（%）
- 備抵呆帳提足率（%）
- 當月轉銷呆帳金額（千元）
- 當年度轉銷呆帳金額累計至資料月份（千元）

可用的計算方式：
- 市占率 = 個別銀行數值 ÷ 總計數值 × 100%
- 月增率(MoM) = (本月 − 上月) ÷ 上月 × 100%
- 排名 = 依數值大小排序
- 有效卡率 = 有效卡數 ÷ 流通卡數 × 100%
- 停卡率 = 當月停卡數 ÷ 流通卡數 × 100%
- 單卡平均消費力 = 當月簽帳金額 ÷ 有效卡數
- 循環信用使用率 = 循環信用餘額 ÷ 當月簽帳金額 × 100%
- 比率類欄位可直接引用
- 年增率(YoY) 無法計算，因為沒有 113 年度資料`;

const MAP_SYSTEM = `你是金融數據分析專家。使用者列出的每一個指標，你都必須逐項回答能不能算，一項都不能跳過。

${AVAILABLE_COLUMNS}

能算的放進 metrics，並寫出確切公式與對報告對象的意義。
不能算的放進 unsupported，並說明缺少什麼資料。

輸出範例（格式示範）：
{
  "metrics": [
    {
      "id": "m1",
      "name": "簽帳金額市占率",
      "definition": "個別銀行當月簽帳金額 ÷ 總計當月簽帳金額 × 100%",
      "category": "市占率",
      "supported": true,
      "relevanceToAudience": "直接反映在消費市場的競爭地位，是主管最關注的排名依據"
    }
  ],
  "unsupported": [
    { "name": "年增率(YoY)", "reason": "資料僅含 114 年度，缺少 113 年同期數值可供比較" }
  ]
}`;

export async function discoverMetrics(
  prompt: string,
  excelSummary: string,
  audience: AudienceContext,
): Promise<{ metrics: MetricSpec[]; unsupported: { name: string; reason: string }[] }> {
  // Pass 1 — what did the user actually ask for
  const extracted = await aiJSON<{ requestedMetrics: string[] }>(
    EXTRACT_SYSTEM,
    `使用者需求原文：\n${prompt}`,
    6000,
    'extract',
  );
  const requested = (extracted?.requestedMetrics ?? []).filter(m => !isPlaceholder(m));
  console.log(`[Metrics] user asked for ${requested.length}:`, requested);

  // Pass 2 — answer each one
  const mapped = await aiJSON<{ metrics: MetricSpec[]; unsupported: { name: string; reason: string }[] }>(
    MAP_SYSTEM,
    requested.length > 0
      ? `報告對象：${audience.audience}
報告目的：${audience.purpose}
重點面向：${audience.focusAreas.join('、')}

使用者明確要求的指標，請逐項回答：
${requested.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : `報告對象：${audience.audience}
報告目的：${audience.purpose}
重點面向：${audience.focusAreas.join('、')}

使用者需求原文：
${prompt}

資料概要：
${excelSummary}

使用者沒有列出具體指標，請根據需求與可用欄位，推導出應該分析的指標（8-12 個）。`,
    9000,
    'map',
  );

  const metrics = (mapped?.metrics ?? []).filter(m => m?.name && !isPlaceholder(m.name));
  const unsupported = (mapped?.unsupported ?? []).filter(u => u?.name && !isPlaceholder(u.name));

  // Pass 3 — fill in anything the model skipped
  const covered = [...metrics.map(m => m.name), ...unsupported.map(u => u.name)];
  const missing = requested.filter(
    req => !covered.some(name => name.includes(req) || req.includes(name)),
  );

  if (missing.length > 0) {
    console.log('[Metrics] supplementing missing:', missing);
    const supplement = await aiJSON<{ metrics: MetricSpec[]; unsupported: { name: string; reason: string }[] }>(
      MAP_SYSTEM,
      `以下指標在上一輪被遺漏，請逐項補上：
${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}

已經處理過的指標（不要重複）：${covered.join('、') || '無'}`,
      8000,
      'supplement',
    );

    const seen = new Set(metrics.map(m => m.name));
    for (const m of supplement?.metrics ?? []) {
      if (m?.name && !isPlaceholder(m.name) && !seen.has(m.name)) {
        metrics.push(m);
        seen.add(m.name);
      }
    }
    for (const u of supplement?.unsupported ?? []) {
      if (u?.name && !isPlaceholder(u.name)) unsupported.push(u);
    }
  }

  const withIds = metrics.map((m, i) => ({ ...m, id: `m${i + 1}`, supported: true }));
  console.log(`[Metrics] final ${withIds.length} supported / ${unsupported.length} unsupported`);
  return { metrics: withIds, unsupported };
}

// ─── Step 3: Insights ────────────────────────────────────────

const INSIGHTS_SYSTEM = `你是策略顧問，負責從數據中找出有決策價值的洞察。

每個洞察必須包含：
- topic：主題名稱，對應一個分析面向
- keyFinding：核心發現。像新聞標題一樣具體，必須含數字
- dataPoints：2 到 4 個支撐數據，每一筆都要標明銀行、期間、數值，且必須出自提供的數據
- implication：這件事對台新的意義（So What）
- recommendation：具體可執行的建議（Now What），要能指出做什麼、對誰做
- chartSuggestion：line／bar／kpi／comparison／table 之一

品質要求：
- 洞察要有解讀，不能只是把數字念一遍
- 要指出趨勢、落差、異常、機會或威脅
- 建議要具體到可以排進工作計畫，不要寫「加強行銷」這種空話
- 只能用提供的數據。資料不足的面向就不要產出該洞察，也不要用推測補足
- 每個重點面向產出 1 到 2 個洞察

輸出範例（格式示範，內容要換成依實際數據的分析）：
{
  "insights": [
    {
      "topic": "簽帳金額市占率競爭態勢",
      "keyFinding": "前二大銀行合計市占 36.55%，台新以 10.67% 位居第五，與第四名玉山僅差 1.30 個百分點",
      "dataPoints": [
        "中國信託 11412 簽帳金額市占率 18.50%，排名第 1",
        "玉山銀行 11412 簽帳金額市占率 11.97%，排名第 4",
        "台新銀行 11412 簽帳金額市占率 10.67%，排名第 5"
      ],
      "implication": "台新與第四名差距不到 1.5 個百分點，屬於可在一年內翻轉的距離，但同時也面臨被第六名追上的風險",
      "recommendation": "鎖定玉山重疊客群的高頻消費場景，優先在餐飲與網購通道加碼回饋，目標一年內將市占推升至 12%",
      "chartSuggestion": "bar"
    }
  ]
}`;

export async function generateInsights(
  prompt: string,
  dataSummary: string,
  audience: AudienceContext,
  metrics: MetricSpec[],
): Promise<TopicInsight[]> {
  const supported = metrics.filter(m => m.supported);
  // Keep the batch small: this model spends most of its budget on reasoning
  // tokens, and asking for many long insights at once truncates the JSON.
  const target = Math.max(3, Math.min(audience.focusAreas.length, 6));

  const styleNotes = [
    audience.narrativeStyle.length ? `敘述風格要求：${audience.narrativeStyle.join('；')}` : '',
    audience.chartPreferences.length ? `圖表偏好：${audience.chartPreferences.join('；')}` : '',
    audience.constraints.length ? `必須遵守的限制：${audience.constraints.join('；')}` : '',
  ].filter(Boolean).join('\n');

  const parsed = await aiJSON<{ insights: TopicInsight[] }>(
    INSIGHTS_SYSTEM,
    `報告對象：${audience.audience}
報告目的：${audience.purpose}
語氣：${audience.tone}
深度：${audience.depth}
重點面向：${audience.focusAreas.join('、')}
${styleNotes ? `\n${styleNotes}\n` : ''}
可用指標：
${supported.map(m => `• ${m.name}（${m.category}）— ${m.definition}`).join('\n')}

實際數據：
${dataSummary}

使用者需求原文：
${prompt}

請產出 ${target} 個洞察，每個重點面向都要被涵蓋。
dataPoints 每筆一句話即可，implication 與 recommendation 各控制在 60 字以內，避免輸出被截斷。`,
    12000,
    'insights',
  );

  const insights = (parsed?.insights ?? []).filter(
    i => i?.topic && i?.keyFinding && !isPlaceholder(i.topic) && !isPlaceholder(i.keyFinding),
  );

  console.log(`[Insights] ${insights.length} usable insights`);
  return insights;
}

// ─── Step 4: Blueprint ───────────────────────────────────────

function buildLayoutBudget(audience: AudienceContext, insightCount: number) {
  // Structural pages: cover, toc, backcover, plus one title page per section.
  const requested = audience.requestedPageCount;
  if (requested) {
    return {
      total: requested,
      note: `使用者明確要求 ${requested} 頁，總頁數必須剛好等於 ${requested}`,
    };
  }
  const byDepth = audience.depth === 'executive' ? 10 : audience.depth === 'technical' ? 18 : 14;
  const byInsight = 5 + insightCount * 2;
  const total = Math.max(9, Math.min(Math.max(byDepth, byInsight), 20));
  return {
    total,
    note: `使用者沒有指定頁數。依受眾深度（${audience.depth}）與洞察數量（${insightCount}）規劃約 ${total} 頁`,
  };
}


const OUTLINE_SYSTEM = `你是簡報架構設計師。先規劃整份簡報的段落大綱，不要展開到每一頁。

## 設計邏輯
1. 結論先行：封面與目錄之後，先給一頁主要結論
2. 敘事弧線：現況定位 → 關鍵發現 → 成因拆解 → 策略建議
3. 每個段落只承擔一個角色，段落名稱要有訊息
4. 受眾調整：executive 重結論與建議，technical 補方法論與資料限制

## 段落規劃規則
- 第一個段落固定是「開場」，含封面、目錄、主要結論共 3 頁
- 中間 2 到 4 個分析段落，每段 contentPages 為 2 到 4
- 倒數第二個段落是結論與建議
- 最後一個段落是「結語」，只有封底 1 頁
- 每個分析段落要指定它承接哪些洞察主題（insightTopics）

輸出範例（格式示範，內容依實際分析結果重新規劃）：
{
  "narrative": "台新與第四名差距縮小至 1.3 個百分點，明年是搶進前四的窗口",
  "sections": [
    { "title": "開場", "purpose": "兩頁內讓主管掌握全局與主要結論", "contentPages": 1, "insightTopics": [] },
    { "title": "市場定位", "purpose": "用市占與排名確立台新目前的競爭位置", "contentPages": 3, "insightTopics": ["簽帳金額市占率競爭態勢"] },
    { "title": "成長動能", "purpose": "拆解月增率與消費力的成長來源", "contentPages": 2, "insightTopics": ["簽帳金額月增率表現"] },
    { "title": "結論與建議", "purpose": "收斂成可執行的優先行動", "contentPages": 2, "insightTopics": [] },
    { "title": "結語", "purpose": "結束", "contentPages": 0, "insightTopics": [] }
  ]
}`;

const SECTION_PAGES_SYSTEM = `你是簡報架構設計師。把一個段落展開成具體的頁面。

## 規則
1. 一頁一個訊息：message 是這頁唯一想讓聽眾記住的句子，必須具體且含數字
2. pageTitle 是這個訊息的濃縮。不可以只寫「數據分析」、「市占率」這種沒有訊息的標籤
3. 數據與洞察成對：同一頁要有數據元素（chart／kpi_block／comparison／table）
   也要有解讀元素（insight／text_block）
4. 視覺節奏：同一段落內不要每頁都用一樣的元素組合
5. content 頁的版面覆蓋率目標 75-85%，每個元素帶 size 欄位（small/medium/large/full）
6. 用到數據的頁面在 metricIds 標明，承接洞察的在 insightTopics 標明
7. 如果一個元素的資料量很大（10家以上比較、多行表格），給 size="full" 獨佔一頁
8. 寧可拆成兩頁讓每頁充實清晰，也不要擠在一頁

## 元素填入指南
- chart: size="large"，搭配 kpi_block(size="medium") 標註關鍵數字
- kpi_block: 數量依 prompt 決定，不要自行限制
- comparison: 銀行數量依 prompt 決定（使用者說幾家就幾家）
- text_block: 3-4 句完整分析（趨勢描述+原因推斷+策略意涵）, size="medium"
- bullet_list: 每條都要有數字和觀點, size 依條目數決定
- insight: 策略性結論（含行動方向）, size="small"
- source: size="small"，每頁都要有

## 可用元素
heading、chart、kpi_block、comparison、table、insight、text_block、bullet_list、source

輸出範例（格式示範，內容依實際段落重新設計）：
{
  "pages": [
    {
      "pageTitle": "與第四名差距縮小至 1.30 個百分點",
      "layout": "content",
      "message": "台新 10.67% 對玉山 11.97%，差距是三年來最小",
      "elements": ["heading", "chart", "kpi_block", "insight", "source"],
      "metricIds": ["m1"],
      "insightTopics": ["簽帳金額市占率競爭態勢"]
    },
    {
      "pageTitle": "前五大銀行合計掌握七成市場",
      "layout": "content",
      "message": "中信與國泰合計 36.55%，市場集中度持續升高",
      "elements": ["heading", "comparison", "text_block", "source"],
      "metricIds": ["m1"],
      "insightTopics": ["簽帳金額市占率競爭態勢"]
    }
  ]
}`;

interface OutlineSection {
  title: string;
  purpose: string;
  contentPages: number;
  insightTopics?: string[];
}

/**
 * Adjusts the outline's content-page counts in place so the finished deck lands
 * on the target page count.
 *
 * Page accounting:
 *   opening section  → cover + toc + its contentPages
 *   middle sections  → 1 section_title + its contentPages
 *   closing section  → 1 backcover
 */
function normaliseOutlineToBudget(sections: OutlineSection[], target: number): void {
  if (sections.length < 2) return;

  const clampContent = (s: OutlineSection, min: number, max: number) => {
    const n = Number.isFinite(s.contentPages) ? Math.round(s.contentPages) : min;
    s.contentPages = Math.max(min, Math.min(n, max));
  };

  const opening = sections[0];
  const closing = sections[sections.length - 1];
  const middle = sections.slice(1, -1);

  // Nothing to distribute across; leave as-is.
  if (middle.length === 0) return;

  // With few sections each one has to carry more pages to reach the target,
  // so the ceiling scales with how much there is to distribute.
  const spare = target - (2 + 1 + middle.length + 1);
  const maxPerSection = Math.max(4, Math.ceil(spare / middle.length) + 1);

  clampContent(opening, 0, 1);
  closing.contentPages = 0;
  middle.forEach(s => clampContent(s, 1, maxPerSection));

  const fixed = () => 2 + opening.contentPages + middle.length + 1;
  const totalOf = () => fixed() + middle.reduce((n, s) => n + s.contentPages, 0);

  let guard = 0;
  while (totalOf() > target && guard++ < 200) {
    // Trim the section with the most content pages first.
    const widest = middle.reduce((a, b) => (b.contentPages > a.contentPages ? b : a));
    if (widest.contentPages > 1) {
      widest.contentPages--;
    } else if (opening.contentPages > 0) {
      opening.contentPages = 0;
    } else if (middle.length > 1) {
      // Every section is already minimal: drop the last analysis section.
      const removed = middle.pop()!;
      const at = sections.indexOf(removed);
      if (at > 0) sections.splice(at, 1);
    } else {
      break;
    }
  }

  guard = 0;
  while (totalOf() < target && guard++ < 200) {
    // Grow the thinnest section first so coverage stays even.
    const thinnest = middle.reduce((a, b) => (b.contentPages < a.contentPages ? b : a));
    if (thinnest.contentPages < maxPerSection) {
      thinnest.contentPages++;
    } else if (opening.contentPages < 1) {
      opening.contentPages = 1;
    } else {
      break;
    }
  }

  console.log(`[Blueprint] outline normalised to ${totalOf()} pages (target ${target})`);
}

/**
 * Designs the deck in two phases so no single request approaches the gateway
 * timeout: a cheap section outline, then one small expansion per section.
 */
export async function designSlideArchitecture(
  audience: AudienceContext,
  metrics: MetricSpec[],
  insights: TopicInsight[],
  prompt: string,
  onProgress?: (detail: string) => void,
): Promise<SlideArchitecture> {
  const supported = metrics.filter(m => m.supported);
  const budget = buildLayoutBudget(audience, insights.length);

  const designNotes = [
    audience.designDirectives.length ? `版面與視覺要求：${audience.designDirectives.join('；')}` : '',
    audience.narrativeStyle.length ? `文字敘述要求：${audience.narrativeStyle.join('；')}` : '',
    audience.chartPreferences.length ? `圖表偏好：${audience.chartPreferences.join('；')}` : '',
    audience.constraints.length ? `必須遵守：${audience.constraints.join('；')}` : '',
  ].filter(Boolean).join('\n');

  const insightDigest = insights
    .map(i => `【${i.topic}】${i.keyFinding}（建議圖表：${i.chartSuggestion ?? '未指定'}）`)
    .join('\n');

  // ── Phase A: section outline ──
  onProgress?.('規劃段落大綱');
  const outline = await aiJSON<{ narrative: string; sections: OutlineSection[] }>(
    OUTLINE_SYSTEM,
    `## 報告對象
受眾：${audience.audience}
目的：${audience.purpose}
深度：${audience.depth}
重點面向：${audience.focusAreas.join('、')}

## 頁數要求
${budget.note}
段落頁數加總（含封面、目錄、主要結論、各段落標題頁、封底）必須等於 ${budget.total} 頁。

${designNotes ? `## 使用者的設計要求\n${designNotes}\n` : ''}
## 已產出的洞察（${insights.length} 個）
${insightDigest}

## 使用者需求原文
${prompt}

請規劃段落大綱。purpose 控制在 40 字以內。`,
    // Small output, but the reasoning model needs headroom before it starts
    // emitting JSON; too low a cap truncates mid-object.
    10000,
    'outline',
  );

  const outlineSections = (outline?.sections ?? []).filter(
    s => s?.title && !isPlaceholder(s.title),
  );

  if (outlineSections.length === 0) {
    console.warn('[Blueprint] outline unusable, building from insights');
    return buildFallbackArchitecture(audience, insights, supported, budget.total);
  }

  const narrative = outline?.narrative && !isPlaceholder(outline.narrative)
    ? outline.narrative
    : `${audience.audience}：${audience.purpose}`;

  normaliseOutlineToBudget(outlineSections, budget.total);

  // ── Phase B: expand each section ──
  const sections: SlideArchitecture['sections'] = [];

  for (let idx = 0; idx < outlineSections.length; idx++) {
    const s = outlineSections[idx];
    const isFirst = idx === 0;
    const isLast = idx === outlineSections.length - 1;
    onProgress?.(`展開段落 ${idx + 1}/${outlineSections.length}：${s.title}`);

    // Opening and closing sections are structural; build them directly.
    if (isFirst) {
      const pages: BlueprintPage[] = [
        {
          pageTitle: audience.purpose,
          layout: 'cover',
          message: narrative,
          elements: ['title', 'subtitle'],
        },
        {
          pageTitle: '目錄',
          layout: 'toc',
          message: `本報告分為 ${outlineSections.length - 2} 個分析主題與結論建議`,
          elements: ['heading', 'bullet_list'],
        },
      ];
      if ((s.contentPages ?? 1) > 0 && insights.length > 0) {
        pages.push({
          pageTitle: insights[0].keyFinding.slice(0, 40),
          layout: 'content',
          message: narrative,
          elements: ['heading', 'kpi_block', 'insight', 'source'],
          metricIds: supported.slice(0, 3).map(m => m.id),
          insightTopics: insights.slice(0, 2).map(i => i.topic),
        });
      }
      sections.push({ title: s.title, purpose: s.purpose, pages });
      continue;
    }

    if (isLast) {
      sections.push({
        title: s.title,
        purpose: s.purpose,
        pages: [{
          pageTitle: '謝謝',
          layout: 'backcover',
          message: '台新新光金控',
          elements: ['title', 'subtitle'],
        }],
      });
      continue;
    }

    // Analysis and conclusion sections get a section title page plus AI-designed content.
    const wanted = Math.max(1, Math.min(s.contentPages ?? 2, 4));
    const relevant = insights.filter(i => (s.insightTopics ?? []).includes(i.topic));
    const pool = relevant.length > 0 ? relevant : insights;

    const expanded = await aiJSON<{ pages: BlueprintPage[] }>(
      SECTION_PAGES_SYSTEM,
      `## 這個段落
名稱：${s.title}
目的：${s.purpose}
要產出 ${wanted} 頁 content

## 報告對象
${audience.audience}（${audience.depth}）
${designNotes ? `\n## 設計要求\n${designNotes}\n` : ''}
## 這個段落要承接的洞察
${pool.map(i => `【${i.topic}】
  發現：${i.keyFinding}
  數據：${i.dataPoints.join('；')}
  意涵：${i.implication}
  建議：${i.recommendation}
  建議圖表：${i.chartSuggestion ?? '未指定'}`).join('\n\n')}

## 可引用的指標
${supported.map(m => `[${m.id}] ${m.name}（${m.category}）`).join('\n')}

請設計這個段落的 ${wanted} 頁 content。message 控制在 50 字以內。`,
      10000,
      `section:${s.title}`,
    );

    const contentPages = (expanded?.pages ?? [])
      .filter(p => p?.pageTitle && !isPlaceholder(p.pageTitle))
      .slice(0, wanted)
      .map(p => ({ ...p, layout: 'content' as const }));

    // If the model gave nothing usable, derive pages from the insights.
    const derived: BlueprintPage[] = contentPages.length > 0
      ? contentPages
      : pool.slice(0, wanted).map(i => ({
          pageTitle: i.keyFinding.slice(0, 40),
          layout: 'content' as const,
          message: i.keyFinding,
          elements: ['heading', 'chart', 'insight', 'source'],
          metricIds: supported.slice(0, 2).map(m => m.id),
          insightTopics: [i.topic],
        }));

    sections.push({
      title: s.title,
      purpose: s.purpose,
      pages: [
        {
          pageTitle: s.title,
          layout: 'section_title',
          message: pool[0]?.keyFinding ?? s.purpose,
          elements: ['title', 'subtitle'],
          insightTopics: (s.insightTopics ?? []).slice(0, 3),
        },
        ...derived,
      ],
    });
  }

  const pageCount = sections.reduce((sum, s) => sum + s.pages.length, 0);
  console.log(`[Blueprint] ${sections.length} sections / ${pageCount} pages (target ${budget.total})`);

  return { totalPages: pageCount, narrative, sections };
}

/**
 * Deterministic architecture used when the model fails to produce a usable
 * design. Built from real insight and metric names so titles carry meaning.
 */
function buildFallbackArchitecture(
  audience: AudienceContext,
  insights: TopicInsight[],
  metrics: MetricSpec[],
  targetPages: number,
): SlideArchitecture {
  const byTopic = new Map<string, TopicInsight[]>();
  for (const i of insights) {
    const list = byTopic.get(i.topic) ?? [];
    list.push(i);
    byTopic.set(i.topic, list);
  }

  const topics = [...byTopic.keys()];
  const sections: SlideArchitecture['sections'] = [];

  sections.push({
    title: '開場',
    purpose: '確立報告範圍與主要結論',
    pages: [
      {
        pageTitle: audience.purpose,
        layout: 'cover',
        message: audience.purpose,
        elements: ['title', 'subtitle'],
      },
      {
        pageTitle: '目錄',
        layout: 'toc',
        message: `本報告涵蓋 ${topics.length || 1} 個分析主題與策略建議`,
        elements: ['heading', 'bullet_list'],
      },
    ],
  });

  for (const [topic, topicInsights] of byTopic) {
    const lead = topicInsights[0];
    sections.push({
      title: topic,
      purpose: lead?.implication || `分析${topic}`,
      pages: [
        {
          pageTitle: topic,
          layout: 'section_title',
          message: lead?.keyFinding || topic,
          elements: ['title', 'subtitle'],
          insightTopics: [topic],
        },
        ...topicInsights.map(ins => ({
          pageTitle: ins.keyFinding.slice(0, 40),
          layout: 'content' as const,
          message: ins.keyFinding,
          elements: [
            'heading',
            ins.chartSuggestion === 'kpi' ? 'kpi_block'
              : ins.chartSuggestion === 'comparison' ? 'comparison'
              : ins.chartSuggestion === 'table' ? 'table'
              : 'chart',
            'insight',
            'source',
          ],
          metricIds: metrics.slice(0, 2).map(m => m.id),
          insightTopics: [topic],
        })),
      ],
    });
  }

  sections.push({
    title: '結論與建議',
    purpose: '收斂成可執行的行動方案',
    pages: [
      {
        pageTitle: '結論與策略建議',
        layout: 'section_title',
        message: '將前述發現收斂為三項優先行動',
        elements: ['title', 'subtitle'],
      },
      {
        pageTitle: '優先行動與目標',
        layout: 'content',
        message: insights[0]?.recommendation || '依分析結果排定優先行動',
        elements: ['heading', 'bullet_list', 'kpi_block'],
        insightTopics: topics,
      },
    ],
  });

  sections.push({
    title: '結語',
    purpose: '結束',
    pages: [
      {
        pageTitle: '謝謝',
        layout: 'backcover',
        message: '台新新光金控',
        elements: ['title', 'subtitle'],
      },
    ],
  });

  const total = sections.reduce((sum, s) => sum + s.pages.length, 0);
  return {
    totalPages: total || targetPages,
    narrative: insights[0]?.keyFinding || `${audience.audience}：${audience.purpose}`,
    sections,
  };
}

// ─── Step 5: Compliance Verification ─────────────────────────

const COMPLIANCE_SYSTEM = `你是品質審核員。比對使用者的原始需求和目前的分析結果，找出所有遺漏。

你要檢查：
1. 使用者提到的每一個分析指標是否都在 metrics 裡有對應？
2. 使用者提到的每一個分析面向是否都有對應的 insight？
3. 使用者要求的報告對象、語氣是否在架構中體現？
4. 使用者提到的設計要求（頁數、圖表風格、文字風格等）是否被執行？
5. 有沒有使用者明確要求但被遺漏的分析點？

對於每個遺漏，提供：
- 缺什麼（gap）
- 如何補（建議新增的 metric 或 insight）

輸出範例（格式示範）：
{
  "passed": false,
  "checkedItems": 12,
  "gaps": [
    "使用者要求分析「停卡率」但 metrics 中沒有此指標",
    "使用者要求「競爭者比較」但洞察中缺少跨銀行比較的主題"
  ],
  "corrections": {
    "additionalMetrics": [
      {"name":"停卡率","definition":"當月停卡數 ÷ 流通卡數 × 100%","category":"效率","relevanceToAudience":"反映客戶流失情況"}
    ],
    "additionalInsights": [
      {"topic":"競爭者比較","keyFinding":"中信與國泰合計市占36.55%，遠超台新10.67%","dataPoints":["中信18.50%","國泰18.05%","台新10.67%"],"implication":"雙強格局穩固，台新需差異化突圍","recommendation":"避免正面價格戰，聚焦特定消費場景","chartSuggestion":"comparison"}
    ]
  }
}

如果全部吻合沒有遺漏，回傳：
{"passed":true,"checkedItems":12,"gaps":[],"corrections":null}`;

interface ComplianceResult {
  passed: boolean;
  checkedItems: number;
  gaps: string[];
  corrections?: {
    additionalMetrics?: MetricSpec[];
    additionalInsights?: TopicInsight[];
  } | null;
}

async function verifyCompliance(
  prompt: string,
  audience: AudienceContext,
  metrics: MetricSpec[],
  insights: TopicInsight[],
  architecture: SlideArchitecture,
): Promise<ComplianceResult> {
  const result = await aiJSON<ComplianceResult>(
    COMPLIANCE_SYSTEM,
    `## 使用者原始需求
${prompt}

## 目前的分析結果

### 報告對象
受眾：${audience.audience}
目的：${audience.purpose}
重點面向：${audience.focusAreas.join('、')}
頁數：${audience.requestedPageCount ?? '系統規劃'}
設計要求：${audience.designDirectives.join('、') || '無'}
文字風格：${audience.narrativeStyle.join('、') || '無'}
圖表偏好：${audience.chartPreferences.join('、') || '無'}
限制：${audience.constraints.join('、') || '無'}

### 已產出的指標（${metrics.length} 個）
${metrics.map(m => `• ${m.name}（${m.category}）`).join('\n')}

### 已產出的洞察（${insights.length} 個）
${insights.map(i => `• 【${i.topic}】${i.keyFinding}`).join('\n')}

### 簡報架構（${architecture.totalPages} 頁）
${architecture.sections.map(s => `段落「${s.title}」: ${s.pages.length} 頁`).join('\n')}

請逐項比對使用者需求，找出所有遺漏或不符之處。`,
    10000,
    'compliance',
  );

  if (!result) {
    return { passed: true, checkedItems: 0, gaps: [] };
  }

  console.log(`[Compliance] passed=${result.passed}, gaps=${result.gaps?.length ?? 0}`);
  if (result.gaps?.length) {
    result.gaps.forEach(g => console.log(`  ⚠ ${g}`));
  }

  return {
    passed: result.passed ?? true,
    checkedItems: result.checkedItems ?? 0,
    gaps: (result.gaps ?? []).filter(g => typeof g === 'string' && !isPlaceholder(g)),
    corrections: result.corrections,
  };
}

// ─── Full Pipeline ───────────────────────────────────────────

export interface PipelineProgress {
  step: number;
  total: number;
  label: string;
  detail?: string;
}

export async function runAIPipeline(
  prompt: string,
  excelSummary: string,
  dataSummary: string,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  const TOTAL = 5;

  onProgress?.({ step: 1, total: TOTAL, label: '解讀需求與報告對象' });
  const audience = await analyzeAudience(prompt, excelSummary);
  onProgress?.({
    step: 1, total: TOTAL, label: '解讀需求與報告對象',
    detail: [
      `對象：${audience.audience}`,
      audience.requestedPageCount ? `指定頁數：${audience.requestedPageCount}` : '頁數：由系統規劃',
      `重點：${audience.focusAreas.slice(0, 3).join('、')}`,
    ].join('｜'),
  });

  onProgress?.({ step: 2, total: TOTAL, label: '探索與驗證分析指標' });
  const { metrics, unsupported } = await discoverMetrics(prompt, excelSummary, audience);
  onProgress?.({
    step: 2, total: TOTAL, label: '探索與驗證分析指標',
    detail: `${metrics.length} 個可計算，${unsupported.length} 個資料不足`,
  });

  onProgress?.({ step: 3, total: TOTAL, label: '生成策略洞察' });
  const insights = await generateInsights(prompt, dataSummary, audience, metrics);
  onProgress?.({
    step: 3, total: TOTAL, label: '生成策略洞察',
    detail: `${insights.length} 個洞察，涵蓋 ${new Set(insights.map(i => i.topic)).size} 個主題`,
  });

  onProgress?.({ step: 4, total: TOTAL, label: '設計簡報架構' });
  const architecture = await designSlideArchitecture(
    audience, metrics, insights, prompt,
    detail => onProgress?.({ step: 4, total: TOTAL, label: '設計簡報架構', detail }),
  );
  onProgress?.({
    step: 4, total: TOTAL, label: '設計簡報架構',
    detail: `${architecture.totalPages} 頁／${architecture.sections.length} 段落`,
  });

  const suggestedSlides = architecture.sections.flatMap(s => s.pages.map(p => p.pageTitle));

  // ── Step 5: Compliance verification ──
  onProgress?.({ step: 5, total: TOTAL, label: '驗證與 prompt 的一致性' });
  const complianceResult = await verifyCompliance(prompt, audience, metrics, insights, architecture);
  onProgress?.({
    step: 5, total: TOTAL, label: '驗證與 prompt 的一致性',
    detail: complianceResult.passed
      ? `✓ 全部吻合（${complianceResult.checkedItems} 項）`
      : `修正 ${complianceResult.gaps.length} 項缺漏`,
  });

  // Apply any corrections the compliance check found
  let finalMetrics = metrics;
  let finalInsights = insights;
  if (!complianceResult.passed && complianceResult.corrections) {
    if (complianceResult.corrections.additionalMetrics?.length) {
      const existing = new Set(metrics.map(m => m.name));
      for (const m of complianceResult.corrections.additionalMetrics) {
        if (!existing.has(m.name)) {
          finalMetrics = [...finalMetrics, { ...m, id: `m${finalMetrics.length + 1}`, supported: true }];
        }
      }
    }
    if (complianceResult.corrections.additionalInsights?.length) {
      const existing = new Set(insights.map(i => i.topic));
      for (const i of complianceResult.corrections.additionalInsights) {
        if (!existing.has(i.topic)) {
          finalInsights = [...finalInsights, i];
        }
      }
    }
  }

  return { audience, metrics: finalMetrics, insights: finalInsights, architecture, unsupported, suggestedSlides };
}
