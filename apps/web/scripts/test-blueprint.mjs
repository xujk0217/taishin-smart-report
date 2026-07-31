/**
 * Exercises the rewritten pipeline prompts against the live proxy.
 * Checks specifically for:
 *   - page count honoured from the prompt
 *   - design directives extracted
 *   - no placeholder ("...") content in insights or blueprint
 */
const ENDPOINT = 'https://dist-phi-flax-58.vercel.app/api/ai';

const PLACEHOLDER_RE = /^[.．。…\s]*$|^(標題|名稱|主題|內容|說明|文字|string|text|title|name|topic)$/i;
const isPlaceholder = v => typeof v === 'string' && (v.trim() === '' || PLACEHOLDER_RE.test(v.trim()));

function countPlaceholders(value) {
  let total = 0, bad = 0;
  const walk = v => {
    if (typeof v === 'string') { total++; if (isPlaceholder(v)) bad++; }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return { total, bad };
}

const NO_PLACEHOLDER_RULE = `
【絕對規則】
- 每一個欄位都必須填入真實、具體的內容
- 嚴禁輸出「...」、「等等」、空字串，或把欄位名稱當成值
- 嚴禁照抄範例中的示意文字
- 所有數字必須來自提供的數據，不可自行編造
- 只輸出 JSON，前後不要有任何說明文字或 markdown 標記`;

let calls = 0;
async function aiJSON(system, user, maxTokens, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    calls++;
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer proxy' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash-free',
        messages: [
          { role: 'system', content: `${system}\n${NO_PLACEHOLDER_RULE}` },
          { role: 'user', content: attempt === 0 ? user : `${user}\n\n【重試提醒】上一次回覆含有未填寫的欄位或「...」。請重新輸出，每個欄位都要有具體內容。` },
        ],
        temperature: attempt === 0 ? 0.25 : 0.45,
        max_tokens: maxTokens,
      }),
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) { console.log(`    ${label} attempt${attempt + 1}: HTTP ${res.status}`); continue; }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    let text = (msg?.content || msg?.reasoning_content || '').trim();
    if (text.startsWith('```')) text = text.split('\n').filter(l => !l.startsWith('```')).join('\n');
    const s = text.indexOf('{'), e = text.lastIndexOf('}') + 1;
    if (s >= 0 && e > s) text = text.slice(s, e);
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { }
    if (!parsed) { console.log(`    ${label} attempt${attempt + 1}: unparseable (${secs}s)`); continue; }
    const { total, bad } = countPlaceholders(parsed);
    if (total === 0 || bad / total > 0.25) {
      console.log(`    ${label} attempt${attempt + 1}: ${bad}/${total} placeholders (${secs}s), retrying`);
      continue;
    }
    console.log(`    ${label}: OK in ${secs}s, ${data.usage?.total_tokens} tokens, ${bad}/${total} placeholders`);
    return parsed;
  }
  return null;
}

// Prompt deliberately specifies page count + design directions
const PROMPT = `請做一份 16 頁的台新信用卡 114 年度市場分析簡報，給信用卡事業部副總經理看。

要分析的指標：
1. 簽帳金額市占率
2. 流通卡數市占率
3. 有效卡率
4. 簽帳金額月增率
5. 單卡平均消費力

設計方向：延續台新品牌紅色系，每頁最多一張主圖表，版面留白多一點。
文字風格：每頁結論先行，句子簡短，避免堆疊專業術語。
圖表風格：趨勢一律用折線圖，排名用橫向柱狀圖。
限制：不要做未來預測，每頁都要標註資料來源。`;

const EXCEL_SUMMARY = `12 份月度 Excel（11401-11412），工作表「揭露.」47 列
欄位: 金融機構名稱, 流通卡數, 有效卡數, 當月發卡數, 當月停卡數, 循環信用餘額, 未到期分期付款餘額, 當月簽帳金額, 當月預借現金金額, 逾期三個月以上比率, 逾期六個月以上比率, 備抵呆帳提足率, 當月轉銷呆帳金額, 當年度轉銷呆帳金額累計`;

const DATA_SUMMARY = `銀行數: 34, 月份數: 12
11412 簽帳金額市占率排名:
  中國信託商業銀行 18.50% (第1)
  國泰世華商業銀行 18.05% (第2)
  台北富邦商業銀行 12.98% (第3)
  玉山商業銀行 11.97% (第4)
  台新國際商業銀行 10.67% (第5)
台新簽帳金額月增率: +11.62%
台新流通卡數市占率: 9.85% (第6)`;

const t0 = Date.now();
const results = { pass: [], fail: [] };
const check = (name, ok, detail = '') => {
  (ok ? results.pass : results.fail).push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// ─── Step 1: Brief ───
console.log('\n=== Step 1: Brief ===');
const brief = await aiJSON(
  `你是台新新光金控的策略顧問，負責解讀使用者的簡報需求。

你要從需求文字中判斷：
1. audience — 這份報告要給誰看
2. purpose — 報告要達成什麼目的
3. tone — 語氣風格
4. focusAreas — 要分析的面向，逐項列出
5. depth — "executive"／"detailed"／"technical"
6. requestedPageCount — 使用者明確要求的頁數。例如「做 20 頁」就填 20。沒提到填 null
7. designDirectives — 對版面、配色、視覺風格的要求
8. narrativeStyle — 對文字敘述的要求
9. chartPreferences — 偏好的圖表型態
10. constraints — 必須遵守的限制

輸出範例（格式示範，內容要換成你的判斷）：
{
  "audience": "信用卡事業部副總經理",
  "purpose": "回顧 114 年度信用卡市場表現並提出下年度競爭策略",
  "tone": "正式策略報告，以數據支撐論點",
  "focusAreas": ["簽帳金額市占率趨勢", "前五大銀行競爭態勢"],
  "depth": "executive",
  "requestedPageCount": 20,
  "designDirectives": ["延續台新品牌紅色系"],
  "narrativeStyle": ["每頁結論先行"],
  "chartPreferences": ["趨勢用折線圖"],
  "constraints": ["不做未來預測"]
}`,
  `使用者的需求原文：\n${PROMPT}\n\n可用資料概要：\n${EXCEL_SUMMARY}\n\n請解讀這份需求。`,
  4000, 'brief',
);

check('brief parsed', !!brief?.audience, brief?.audience);
check('page count = 16 (from prompt)', brief?.requestedPageCount === 16, `got ${brief?.requestedPageCount}`);
check('design directives extracted', (brief?.designDirectives ?? []).length > 0, `${(brief?.designDirectives ?? []).length} items`);
check('narrative style extracted', (brief?.narrativeStyle ?? []).length > 0, `${(brief?.narrativeStyle ?? []).length} items`);
check('chart preferences extracted', (brief?.chartPreferences ?? []).length > 0, `${(brief?.chartPreferences ?? []).length} items`);
check('constraints extracted', (brief?.constraints ?? []).length > 0, `${(brief?.constraints ?? []).length} items`);
if (brief) {
  console.log(`      designDirectives: ${JSON.stringify(brief.designDirectives)}`);
  console.log(`      chartPreferences: ${JSON.stringify(brief.chartPreferences)}`);
  console.log(`      constraints: ${JSON.stringify(brief.constraints)}`);
}

// ─── Step 2: Metrics ───
console.log('\n=== Step 2: Metrics ===');
const extracted = await aiJSON(
  `你是需求解析工具。從使用者的需求文字中，把所有想分析的指標名稱逐項抓出來。
全部列完，不可用省略號。
輸出範例（格式示範）：
{"requestedMetrics": ["簽帳金額市占率", "流通卡數市占率", "有效卡率"]}`,
  `使用者需求原文：\n${PROMPT}`,
  2500, 'extract',
);
const requested = extracted?.requestedMetrics ?? [];
check('extracted >= 5 metrics', requested.length >= 5, `${requested.length}: ${requested.join('、')}`);

const mapped = await aiJSON(
  `你是金融數據分析專家。使用者列出的每一個指標，都必須逐項回答能不能算。

可用欄位：金融機構名稱、流通卡數、有效卡數、當月發卡數、當月停卡數、循環信用餘額、未到期分期付款餘額、當月簽帳金額、當月預借現金金額、逾期比率、備抵呆帳提足率、轉銷呆帳金額。期間 11401-11412，34 家銀行 + 總計。
年增率(YoY) 無法計算，因為沒有 113 年資料。

輸出範例（格式示範）：
{
  "metrics": [
    { "id": "m1", "name": "簽帳金額市占率", "definition": "個別銀行當月簽帳金額 ÷ 總計 × 100%", "category": "市占率", "supported": true, "relevanceToAudience": "直接反映競爭地位" }
  ],
  "unsupported": [
    { "name": "年增率(YoY)", "reason": "缺少 113 年同期資料" }
  ]
}`,
  `報告對象：${brief?.audience}\n重點面向：${(brief?.focusAreas ?? []).join('、')}\n\n使用者明確要求的指標，請逐項回答：\n${requested.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
  9000, 'map',
);
const metrics = (mapped?.metrics ?? []).filter(m => m?.name && !isPlaceholder(m.name));
const unsupported = mapped?.unsupported ?? [];
check('metric coverage 100%', metrics.length + unsupported.length >= requested.length,
  `${metrics.length + unsupported.length}/${requested.length}`);

// ─── Step 3: Insights ───
console.log('\n=== Step 3: Insights ===');
const insightsRes = await aiJSON(
  `你是策略顧問，負責從數據中找出有決策價值的洞察。

每個洞察必須包含 topic、keyFinding（含數字）、dataPoints（2-4 筆，標明銀行/期間/數值）、implication、recommendation、chartSuggestion。

品質要求：
- keyFinding 要像新聞標題一樣具體，必須含數字
- recommendation 要具體到可排進工作計畫，不要寫「加強行銷」這種空話
- 只能用提供的數據，資料不足的面向就不要產出洞察

輸出範例（格式示範，內容要換成依實際數據的分析）：
{
  "insights": [
    {
      "topic": "簽帳金額市占率競爭態勢",
      "keyFinding": "前二大銀行合計市占 36.55%，台新以 10.67% 位居第五，與第四名玉山僅差 1.30 個百分點",
      "dataPoints": ["中國信託 11412 市占率 18.50% 排名第1", "玉山銀行 11412 市占率 11.97% 排名第4", "台新銀行 11412 市占率 10.67% 排名第5"],
      "implication": "台新與第四名差距不到 1.5 個百分點，屬於可在一年內翻轉的距離",
      "recommendation": "鎖定玉山重疊客群的高頻消費場景，優先在餐飲與網購通道加碼回饋，目標一年內市占推升至 12%",
      "chartSuggestion": "bar"
    }
  ]
}`,
  `報告對象：${brief?.audience}
重點面向：${(brief?.focusAreas ?? []).join('、')}
敘述風格要求：${(brief?.narrativeStyle ?? []).join('；')}
圖表偏好：${(brief?.chartPreferences ?? []).join('；')}
必須遵守：${(brief?.constraints ?? []).join('；')}

可用指標：
${metrics.map(m => `• ${m.name} — ${m.definition}`).join('\n')}

實際數據：
${DATA_SUMMARY}

請產出 6 個洞察，每個重點面向都要涵蓋。`,
  9000, 'insights',
);
const insights = (insightsRes?.insights ?? []).filter(i => i?.topic && !isPlaceholder(i.topic) && !isPlaceholder(i.keyFinding));
check('insights >= 4', insights.length >= 4, `${insights.length}`);
const insightsHaveNumbers = insights.every(i => /\d/.test(i.keyFinding ?? ''));
check('every keyFinding contains a number', insightsHaveNumbers);
const insightsNoPlaceholder = insights.every(i =>
  !isPlaceholder(i.implication) && !isPlaceholder(i.recommendation) && (i.dataPoints ?? []).length > 0);
check('insights fully filled', insightsNoPlaceholder);
insights.slice(0, 3).forEach(i => console.log(`      【${i.topic}】${i.keyFinding.slice(0, 60)}`));

// ─── Step 4: Blueprint ───
console.log('\n=== Step 4: Blueprint ===');
const blueprint = await aiJSON(
  `你是簡報架構設計師，要把分析結果編排成一份可以直接上台講的簡報。

## 設計邏輯
1. 結論先行：封面之後先給主要結論
2. 敘事弧線：現況定位 → 關鍵發現 → 成因拆解 → 策略建議
3. 一頁一個訊息：message 是這頁唯一想讓聽眾記住的句子，必須具體且含數字。
   pageTitle 是這個訊息的濃縮，不可以只寫「數據分析」這種沒有訊息的標籤
4. 數據與洞察成對：同頁要有數據元素也要有解讀元素
5. 視覺節奏：不要連續三頁同一種版面

## 版面：cover / toc / section_title / content / backcover
## 元素：heading、chart、kpi_block、comparison、table、insight、text_block、bullet_list、source

## 結構規則
- 第 1 頁 cover，第 2 頁 toc，最後一頁 backcover
- 每個段落第一頁是 section_title，後面至少 1 頁 content
- content 頁的 elements 列 3 到 5 個
- 用到數據的頁面在 metricIds 標明，承接洞察的在 insightTopics 標明

輸出範例（格式示範，內容要依實際分析結果重新設計）：
{
  "totalPages": 12,
  "narrative": "台新在簽帳金額市占穩居第五，與第四名差距已縮小到 1.3 個百分點，接下來一年是搶進前四的窗口",
  "sections": [
    {
      "title": "開場",
      "purpose": "讓主管在前兩頁掌握全局",
      "pages": [
        { "pageTitle": "114 年度信用卡市場競爭分析", "layout": "cover", "message": "回顧 114 年度表現並提出前進前四的策略", "elements": ["title", "subtitle"] },
        { "pageTitle": "目錄", "layout": "toc", "message": "本報告分為市場定位、成長動能、策略建議三部分", "elements": ["heading", "bullet_list"] }
      ]
    },
    {
      "title": "市場定位",
      "purpose": "用市占與排名確立競爭位置",
      "pages": [
        { "pageTitle": "市場定位：台新市占 10.67%，排名第五", "layout": "section_title", "message": "台新在 34 家銀行中位居第五", "elements": ["title", "subtitle"] },
        { "pageTitle": "與第四名差距縮小至 1.3 個百分點", "layout": "content", "message": "台新 10.67% 對玉山 11.97%，差距三年最小", "elements": ["heading", "chart", "kpi_block", "insight", "source"], "metricIds": ["m1"], "insightTopics": ["簽帳金額市占率競爭態勢"] }
      ]
    }
  ]
}`,
  `## 報告對象
受眾：${brief?.audience}
目的：${brief?.purpose}
深度：${brief?.depth}
重點面向：${(brief?.focusAreas ?? []).join('、')}

## 頁數要求
使用者明確要求 ${brief?.requestedPageCount ?? 16} 頁，總頁數必須剛好等於 ${brief?.requestedPageCount ?? 16}

## 使用者的設計要求
版面與視覺：${(brief?.designDirectives ?? []).join('；')}
文字敘述：${(brief?.narrativeStyle ?? []).join('；')}
圖表偏好：${(brief?.chartPreferences ?? []).join('；')}
必須遵守：${(brief?.constraints ?? []).join('；')}

## 可用指標（${metrics.length} 個）
${metrics.map(m => `[${m.id}] ${m.name} — ${m.relevanceToAudience || m.definition}`).join('\n')}

## 已產出的洞察（${insights.length} 個）
${insights.map(i => `【${i.topic}】\n  發現：${i.keyFinding}\n  建議：${i.recommendation}\n  建議圖表：${i.chartSuggestion}`).join('\n\n')}

請設計簡報架構。每個洞察都要有對應頁面，總頁數必須符合上面的頁數要求。`,
  12000, 'blueprint',
);

const sections = (blueprint?.sections ?? []).filter(s => s?.title && !isPlaceholder(s.title) && s.pages?.length);
const allPages = sections.flatMap(s => s.pages ?? []);
check('blueprint has sections', sections.length >= 3, `${sections.length} sections`);
check(`page count near 16`, Math.abs(allPages.length - 16) <= 2, `${allPages.length} pages`);
check('page 1 is cover', allPages[0]?.layout === 'cover', allPages[0]?.layout);
check('page 2 is toc', allPages[1]?.layout === 'toc', allPages[1]?.layout);
check('last page is backcover', allPages.at(-1)?.layout === 'backcover', allPages.at(-1)?.layout);
const titlesMeaningful = allPages.every(p => p.pageTitle && !isPlaceholder(p.pageTitle) && p.pageTitle.length > 2);
check('all page titles meaningful', titlesMeaningful);
const contentPages = allPages.filter(p => p.layout === 'content');
const contentHaveElements = contentPages.every(p => (p.elements ?? []).length >= 3);
check('content pages have 3+ elements', contentHaveElements, `${contentPages.length} content pages`);
const messagesHaveContent = allPages.every(p => p.message && !isPlaceholder(p.message));
check('every page has a message', messagesHaveContent);

console.log(`\n  narrative: ${blueprint?.narrative}`);
console.log('\n  Structure:');
for (const s of sections) {
  console.log(`    § ${s.title}`);
  for (const p of s.pages ?? []) {
    console.log(`        [${p.layout}] ${p.pageTitle}`);
  }
}

// ─── Summary ───
console.log(`\n${'='.repeat(64)}`);
console.log(`${results.pass.length} passed, ${results.fail.length} failed`);
console.log(`${calls} AI calls in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (results.fail.length) {
  console.log('\nFailures:');
  results.fail.forEach(f => console.log(`  - ${f}`));
}
console.log('='.repeat(64));
process.exit(results.fail.length === 0 ? 0 : 1);
