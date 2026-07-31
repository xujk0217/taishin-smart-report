/**
 * End-to-end verification of the app's data flow, using the real 12 monthly
 * Excel files and the live AI proxy.
 *
 * Mirrors what App.tsx does, stage by stage:
 *   upload    → read + merge Excel
 *   analyzing → AI pipeline (brief → metrics → insights → blueprint)
 *   plan      → convert pipeline result into the plan screen's shape
 *   processing→ compute metrics, generate slide spec from the blueprint
 *   preview   → provenance tracing for every slide element
 *   exporting → PPTX + XLSX structure
 */
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

const ENDPOINT = 'https://dist-phi-flax-58.vercel.app/api/ai';
const DATA_DIR = '../../114信用卡資料';

const results = [];
const check = (stage, name, pass, detail = '') => {
  results.push({ stage, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};
const stage = n => console.log(`\n${'─'.repeat(64)}\n${n}\n${'─'.repeat(64)}`);

const PROMPT = `請做一份 14 頁的台新信用卡 114 年度市場分析簡報，給信用卡事業部副總經理看。

要分析的指標：
1. 簽帳金額市占率
2. 流通卡數市占率
3. 有效卡率
4. 簽帳金額月增率
5. 單卡平均消費力

設計方向：延續台新品牌紅色系，每頁最多一張主圖表。
文字風格：每頁結論先行，句子簡短。
圖表風格：趨勢用折線圖，排名用柱狀圖。
限制：不要做未來預測，每頁標註資料來源。`;

// ─── Shared AI helper (mirrors ai-pipeline.ts) ───────────────

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

function repairTruncatedJSON(text) {
  const stack = [];
  let inString = false, escaped = false, lastSafe = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') { stack.pop(); if (stack.length <= 2) lastSafe = i; }
  }
  if (lastSafe < 0) return null;
  let candidate = text.slice(0, lastSafe + 1);
  const open = [];
  inString = false; escaped = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') open.push(ch);
    else if (ch === '}' || ch === ']') open.pop();
  }
  while (open.length) candidate += open.pop() === '{' ? '}' : ']';
  try { return JSON.parse(candidate); } catch { return null; }
}

function parseJSON(text) {
  let c = text.trim();
  if (c.startsWith('```')) c = c.split('\n').filter(l => !l.startsWith('```')).join('\n');
  const s = c.indexOf('{');
  if (s < 0) return null;
  c = c.slice(s);
  const e = c.lastIndexOf('}') + 1;
  if (e > 0) { try { return JSON.parse(c.slice(0, e)); } catch { } }
  return repairTruncatedJSON(c);
}

const NO_PLACEHOLDER_RULE = `
【絕對規則】
- 每一個欄位都必須填入真實、具體的內容
- 嚴禁輸出「...」、「等等」、空字串，或把欄位名稱當成值
- 嚴禁照抄範例中的示意文字
- 所有數字必須來自提供的數據，不可自行編造
- 只輸出 JSON，前後不要有任何說明文字或 markdown 標記`;

let aiCalls = 0;
async function aiJSON(system, user, maxTokens, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    aiCalls++;
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer proxy' },
        body: JSON.stringify({
          model: 'deepseek-v4-flash-free',
          messages: [
            { role: 'system', content: `${system}\n${NO_PLACEHOLDER_RULE}` },
            { role: 'user', content: attempt === 0 ? user : `${user}\n\n【重試提醒】上一次回覆含有未填寫的欄位或「...」。請重新輸出。` },
          ],
          temperature: attempt === 0 ? 0.25 : 0.45,
          max_tokens: maxTokens,
        }),
      });
    } catch (e) {
      console.log(`      ${label} attempt${attempt + 1}: network error ${e.message}`);
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!res.ok) { console.log(`      ${label} attempt${attempt + 1}: HTTP ${res.status} (${secs}s)`); continue; }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const parsed = parseJSON(msg?.content || msg?.reasoning_content || '');
    if (!parsed) { console.log(`      ${label} attempt${attempt + 1}: unparseable (${secs}s)`); continue; }
    const { total, bad } = countPlaceholders(parsed);
    if (total === 0 || bad / total > 0.25) {
      console.log(`      ${label} attempt${attempt + 1}: ${bad}/${total} placeholders (${secs}s)`);
      continue;
    }
    console.log(`      ${label}: ${secs}s, ${data.usage?.total_tokens} tokens, ${bad}/${total} placeholders`);
    return parsed;
  }
  return null;
}

// ═══ STAGE 1: upload — read and merge Excel ═══
stage('STAGE 1  upload → read + merge Excel');

if (!existsSync(DATA_DIR)) {
  console.log('  SKIP: 114信用卡資料 not found');
  process.exit(0);
}

const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx')).sort();
check('upload', 'found 12 monthly files', files.length === 12, `${files.length} files`);

const records = [];
for (const f of files) {
  const m = f.match(/(\d{5})/);
  let period = m ? m[1] : (f.includes('2月') ? '11402' : null);
  if (!period) continue;

  const wb = XLSX.read(readFileSync(join(DATA_DIR, f)));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = 3;
  for (let r = 0; r <= 5; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c?.v && String(c.v).includes('金融機構')) { headerRow = r; break; }
  }
  const headers = [];
  for (let c = 0; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    headers.push(cell ? String(cell.v).trim().replace(/\s+/g, '') : `col${c}`);
  }
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const nc = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (!nc?.v) continue;
    const bank = String(nc.v).trim();
    if (bank.startsWith('一、') || bank.startsWith('二、') || /^\d+\./.test(bank)) continue;
    const row = { period, bank, _cells: {} };
    for (let c = 1; c <= Math.min(range.e.c, 13); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v != null) {
        const key = headers[c] || `col${c}`;
        row[key] = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v).replace(/,/g, ''));
        row._cells[key] = XLSX.utils.encode_cell({ r, c });
      }
    }
    records.push(row);
  }
}

const periods = [...new Set(records.map(r => r.period))].sort();
const banks = [...new Set(records.map(r => r.bank))].filter(b => b !== '總計');
check('upload', 'merged 12 periods', periods.length === 12, periods.join(','));
check('upload', 'detected 30+ banks', banks.length >= 30, `${banks.length} banks`);
check('upload', 'records parsed', records.length > 300, `${records.length} rows`);

// ═══ STAGE 2: compute metrics deterministically ═══
stage('STAGE 2  processing → deterministic metric computation');

const latest = periods.at(-1);
const latestRows = records.filter(r => r.period === latest);
const totalRow = latestRows.find(r => r.bank === '總計');
const totalAmt = totalRow?.['當月簽帳金額'] ?? 0;
const totalCards = totalRow?.['流通卡數'] ?? 0;

check('compute', 'total row present', totalAmt > 0, `簽帳金額總計 ${totalAmt.toLocaleString()} 千元`);

const computed = banks.map(bank => {
  const row = latestRows.find(r => r.bank === bank);
  const amt = row?.['當月簽帳金額'] ?? 0;
  const cards = row?.['流通卡數'] ?? 0;
  const active = row?.['有效卡數'] ?? 0;
  return {
    bank,
    amountShare: totalAmt ? Math.round((amt / totalAmt) * 10000) / 100 : 0,
    cardShare: totalCards ? Math.round((cards / totalCards) * 10000) / 100 : 0,
    activeRate: cards ? Math.round((active / cards) * 10000) / 100 : 0,
    perCard: active ? Math.round((amt / active) * 100) / 100 : 0,
    cell: row?._cells?.['當月簽帳金額'],
  };
}).sort((a, b) => b.amountShare - a.amountShare);

const taishin = computed.find(c => c.bank.includes('台新'));
const rank = computed.indexOf(taishin) + 1;

check('compute', 'market shares sum to ~100%',
  Math.abs(computed.reduce((s, c) => s + c.amountShare, 0) - 100) < 1.5,
  `${computed.reduce((s, c) => s + c.amountShare, 0).toFixed(2)}%`);
check('compute', 'ranking is sorted descending',
  computed.every((c, i) => i === 0 || computed[i - 1].amountShare >= c.amountShare));
check('compute', '台新 share matches known 10.67%',
  Math.abs(taishin.amountShare - 10.67) < 0.05, `${taishin.amountShare}%`);
check('compute', '台新 rank is 5', rank === 5, `rank ${rank}`);
check('compute', 'source cell traceable', !!taishin.cell, `cell ${taishin.cell}`);

// MoM
const tsSeries = records.filter(r => r.bank.includes('台新')).sort((a, b) => a.period.localeCompare(b.period));
const mom = tsSeries.length >= 2
  ? Math.round(((tsSeries.at(-1)['當月簽帳金額'] - tsSeries.at(-2)['當月簽帳金額']) / tsSeries.at(-2)['當月簽帳金額']) * 10000) / 100
  : 0;
check('compute', 'MoM matches known +11.62%', Math.abs(mom - 11.62) < 0.05, `${mom > 0 ? '+' : ''}${mom}%`);

const DATA_SUMMARY = `銀行數: ${banks.length}, 月份數: ${periods.length}
${latest} 簽帳金額市占率排名:
${computed.slice(0, 5).map((c, i) => `  ${c.bank} ${c.amountShare}% (第${i + 1})`).join('\n')}
台新簽帳金額月增率: ${mom > 0 ? '+' : ''}${mom}%
台新流通卡數市占率: ${taishin.cardShare}%
台新有效卡率: ${taishin.activeRate}%
台新單卡平均消費力: ${taishin.perCard} 千元`;

const EXCEL_SUMMARY = `${files.length} 份月度 Excel（${periods[0]}-${periods.at(-1)}）
欄位: 金融機構名稱, 流通卡數, 有效卡數, 當月發卡數, 當月停卡數, 循環信用餘額, 未到期分期付款餘額, 當月簽帳金額, 當月預借現金金額, 逾期三個月以上比率, 逾期六個月以上比率, 備抵呆帳提足率, 當月轉銷呆帳金額, 當年度轉銷呆帳金額累計`;

// ═══ STAGE 3: AI pipeline ═══
stage('STAGE 3  analyzing → AI pipeline (4 steps)');

const brief = await aiJSON(
  `你是台新新光金控的策略顧問。從需求文字判斷 audience、purpose、tone、focusAreas、depth、requestedPageCount（使用者明確要求的頁數，沒說填 null）、designDirectives、narrativeStyle、chartPreferences、constraints。

輸出範例（格式示範，內容換成你的判斷）：
{"audience":"信用卡事業部副總經理","purpose":"回顧114年度表現並提出競爭策略","tone":"正式策略報告","focusAreas":["市占率趨勢","競爭態勢"],"depth":"executive","requestedPageCount":20,"designDirectives":["延續品牌紅色系"],"narrativeStyle":["結論先行"],"chartPreferences":["趨勢用折線圖"],"constraints":["不做預測"]}`,
  `使用者需求原文：\n${PROMPT}\n\n資料概要：\n${EXCEL_SUMMARY}`,
  8000, 'brief',
);

check('pipeline', 'brief returned', !!brief?.audience, brief?.audience);
check('pipeline', 'page count = 14 from prompt', brief?.requestedPageCount === 14, `got ${brief?.requestedPageCount}`);
check('pipeline', 'design directives captured', (brief?.designDirectives ?? []).length > 0,
  JSON.stringify(brief?.designDirectives ?? []));
check('pipeline', 'chart preferences captured', (brief?.chartPreferences ?? []).length > 0,
  JSON.stringify(brief?.chartPreferences ?? []));
check('pipeline', 'constraints captured', (brief?.constraints ?? []).length > 0,
  JSON.stringify(brief?.constraints ?? []));

const extracted = await aiJSON(
  `你是需求解析工具。把使用者想分析的指標名稱逐項抓出來，全部列完不可省略。
輸出範例：{"requestedMetrics":["簽帳金額市占率","流通卡數市占率","有效卡率"]}`,
  `使用者需求原文：\n${PROMPT}`,
  6000, 'extract',
);
const requested = (extracted?.requestedMetrics ?? []).filter(m => !isPlaceholder(m));
check('pipeline', 'extracted all 5 requested metrics', requested.length >= 5,
  `${requested.length}: ${requested.join('、')}`);

const mapped = await aiJSON(
  `你是金融數據分析專家。逐項回答每個指標能否計算，一項都不能跳過。
可用欄位：流通卡數、有效卡數、當月發卡數、當月停卡數、循環信用餘額、未到期分期付款餘額、當月簽帳金額、當月預借現金金額、逾期比率、備抵呆帳提足率、轉銷呆帳金額。期間 11401-11412。年增率(YoY)無法計算（缺113年資料）。

輸出範例：
{"metrics":[{"id":"m1","name":"簽帳金額市占率","definition":"個別銀行當月簽帳金額 ÷ 總計 × 100%","category":"市占率","supported":true,"relevanceToAudience":"反映競爭地位"}],"unsupported":[{"name":"年增率(YoY)","reason":"缺少113年同期資料"}]}`,
  `報告對象：${brief?.audience}\n\n使用者要求的指標，逐項回答：\n${requested.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
  9000, 'map',
);
const metrics = (mapped?.metrics ?? []).filter(m => m?.name && !isPlaceholder(m.name)).map((m, i) => ({ ...m, id: `m${i + 1}` }));
const unsupported = mapped?.unsupported ?? [];
check('pipeline', 'metric coverage 100%',
  metrics.length + unsupported.length >= requested.length,
  `${metrics.length + unsupported.length}/${requested.length}`);
check('pipeline', 'every metric has a formula',
  metrics.every(m => m.definition && !isPlaceholder(m.definition)));

const insightsRes = await aiJSON(
  `你是策略顧問。每個洞察含 topic、keyFinding（含數字）、dataPoints（2-4筆）、implication、recommendation、chartSuggestion。
keyFinding 要像新聞標題一樣具體。recommendation 要具體可執行。只能用提供的數據。

輸出範例：
{"insights":[{"topic":"簽帳金額市占率競爭態勢","keyFinding":"台新以10.67%位居第五，與第四名玉山僅差1.30個百分點","dataPoints":["台新 11412 市占率 10.67% 第5","玉山 11412 市占率 11.97% 第4"],"implication":"差距不到1.5個百分點，一年內可翻轉","recommendation":"鎖定玉山重疊客群，餐飲與網購加碼回饋，目標市占12%","chartSuggestion":"bar"}]}`,
  `報告對象：${brief?.audience}
重點面向：${(brief?.focusAreas ?? []).join('、')}
敘述風格：${(brief?.narrativeStyle ?? []).join('；')}
圖表偏好：${(brief?.chartPreferences ?? []).join('；')}
限制：${(brief?.constraints ?? []).join('；')}

可用指標：\n${metrics.map(m => `• ${m.name} — ${m.definition}`).join('\n')}

實際數據：\n${DATA_SUMMARY}

請產出 5 個洞察。dataPoints 每筆一句，implication 與 recommendation 各 60 字內。`,
  16000, 'insights',
);
const insights = (insightsRes?.insights ?? []).filter(i => i?.topic && !isPlaceholder(i.topic) && !isPlaceholder(i.keyFinding));
check('pipeline', 'insights generated', insights.length >= 3, `${insights.length}`);
check('pipeline', 'no placeholder insights', insights.every(i =>
  !isPlaceholder(i.implication) && !isPlaceholder(i.recommendation)));
check('pipeline', 'every keyFinding has a number', insights.every(i => /\d/.test(i.keyFinding)));

// Blueprint runs in two phases so no single call nears the gateway timeout.
const targetPages = brief?.requestedPageCount ?? 14;

const outline = await aiJSON(
  `你是簡報架構設計師。先規劃段落大綱，不要展開到每一頁。
規則：第一個段落固定「開場」（封面+目錄+主要結論共3頁），中間 2-4 個分析段落每段 contentPages 2-4，倒數第二段是結論與建議，最後一段「結語」只有封底。

輸出範例：
{"narrative":"台新與第四名差距縮小至1.3個百分點，明年是搶進前四的窗口","sections":[{"title":"開場","purpose":"掌握全局與主要結論","contentPages":1,"insightTopics":[]},{"title":"市場定位","purpose":"確立競爭位置","contentPages":3,"insightTopics":["簽帳金額市占率競爭態勢"]},{"title":"結論與建議","purpose":"收斂成優先行動","contentPages":2,"insightTopics":[]},{"title":"結語","purpose":"結束","contentPages":0,"insightTopics":[]}]}`,
  `受眾：${brief?.audience}（${brief?.depth}）
重點面向：${(brief?.focusAreas ?? []).join('、')}

頁數要求：使用者明確要求 ${targetPages} 頁，段落頁數加總必須等於 ${targetPages}

設計要求：
版面：${(brief?.designDirectives ?? []).join('；')}
圖表：${(brief?.chartPreferences ?? []).join('；')}

洞察（${insights.length}）：
${insights.map(i => `【${i.topic}】${i.keyFinding}（圖表：${i.chartSuggestion}）`).join('\n')}

請規劃段落大綱。purpose 40 字內。`,
  10000, 'outline',
);

const outlineSections = (outline?.sections ?? []).filter(s => s?.title && !isPlaceholder(s.title));
check('pipeline', 'outline produced sections', outlineSections.length >= 3, `${outlineSections.length} sections`);
check('pipeline', 'outline has a narrative',
  !!outline?.narrative && !isPlaceholder(outline.narrative));

// Mirrors normaliseOutlineToBudget from src/utils/ai-pipeline.ts, so the deck
// lands on the page count the prompt asked for.
function normaliseOutlineToBudget(sections, target) {
  if (sections.length < 2) return;
  const clampContent = (s, min, max) => {
    const n = Number.isFinite(s.contentPages) ? Math.round(s.contentPages) : min;
    s.contentPages = Math.max(min, Math.min(n, max));
  };
  const opening = sections[0];
  const closing = sections[sections.length - 1];
  const middle = sections.slice(1, -1);
  if (middle.length === 0) return;

  const spare = target - (2 + 1 + middle.length + 1);
  const maxPerSection = Math.max(4, Math.ceil(spare / middle.length) + 1);

  clampContent(opening, 0, 1);
  closing.contentPages = 0;
  middle.forEach(s => clampContent(s, 1, maxPerSection));

  const fixed = () => 2 + opening.contentPages + middle.length + 1;
  const totalOf = () => fixed() + middle.reduce((n, s) => n + s.contentPages, 0);

  let guard = 0;
  while (totalOf() > target && guard++ < 200) {
    const widest = middle.reduce((a, b) => (b.contentPages > a.contentPages ? b : a));
    if (widest.contentPages > 1) widest.contentPages--;
    else if (opening.contentPages > 0) opening.contentPages = 0;
    else if (middle.length > 1) {
      const removed = middle.pop();
      const at = sections.indexOf(removed);
      if (at > 0) sections.splice(at, 1);
    } else break;
  }
  guard = 0;
  while (totalOf() < target && guard++ < 200) {
    const thinnest = middle.reduce((a, b) => (b.contentPages < a.contentPages ? b : a));
    if (thinnest.contentPages < maxPerSection) thinnest.contentPages++;
    else if (opening.contentPages < 1) opening.contentPages = 1;
    else break;
  }
}

const beforeNorm = outlineSections.reduce((n, s, i) =>
  n + (i === 0 ? 2 : i === outlineSections.length - 1 ? 1 : 1) + (s.contentPages ?? 0), 0);
normaliseOutlineToBudget(outlineSections, targetPages);
const plannedPages = outlineSections.reduce((n, s, i) =>
  n + (i === 0 ? 2 : i === outlineSections.length - 1 ? 1 : 1) + (s.contentPages ?? 0), 0);
check('pipeline', 'outline normalised to the requested page count',
  plannedPages === targetPages, `${beforeNorm} → ${plannedPages} (target ${targetPages})`);

const sections = [];
for (let idx = 0; idx < outlineSections.length; idx++) {
  const s = outlineSections[idx];
  const isFirst = idx === 0;
  const isLast = idx === outlineSections.length - 1;

  if (isFirst) {
    const ps = [
      { pageTitle: brief?.purpose ?? '信用卡市場分析', layout: 'cover', message: outline.narrative, elements: ['title', 'subtitle'] },
      { pageTitle: '目錄', layout: 'toc', message: `分為 ${outlineSections.length - 2} 個主題與結論`, elements: ['heading', 'bullet_list'] },
    ];
    if ((s.contentPages ?? 1) > 0 && insights.length) {
      ps.push({
        pageTitle: insights[0].keyFinding.slice(0, 40), layout: 'content', message: outline.narrative,
        elements: ['heading', 'kpi_block', 'insight', 'source'],
        metricIds: metrics.slice(0, 3).map(m => m.id),
        insightTopics: insights.slice(0, 2).map(i => i.topic),
      });
    }
    sections.push({ title: s.title, purpose: s.purpose, pages: ps });
    continue;
  }

  if (isLast) {
    sections.push({ title: s.title, purpose: s.purpose, pages: [
      { pageTitle: '謝謝', layout: 'backcover', message: '台新新光金控', elements: ['title', 'subtitle'] },
    ]});
    continue;
  }

  const wanted = Math.max(1, Math.min(s.contentPages ?? 2, 4));
  const relevant = insights.filter(i => (s.insightTopics ?? []).includes(i.topic));
  const pool = relevant.length ? relevant : insights;

  const expanded = await aiJSON(
    `你是簡報架構設計師。把一個段落展開成具體頁面。
規則：一頁一訊息（message 含數字），pageTitle 是訊息濃縮不可只寫標籤，數據元素與解讀元素成對，content 頁 3-5 個元素。
元素：heading、chart、kpi_block、comparison、table、insight、text_block、bullet_list、source

輸出範例：
{"pages":[{"pageTitle":"與第四名差距縮小至1.30個百分點","layout":"content","message":"台新10.67%對玉山11.97%，差距三年最小","elements":["heading","chart","kpi_block","insight","source"],"metricIds":["m1"],"insightTopics":["簽帳金額市占率競爭態勢"]}]}`,
    `段落名稱：${s.title}
段落目的：${s.purpose}
要產出 ${wanted} 頁 content
受眾：${brief?.audience}（${brief?.depth}）
圖表偏好：${(brief?.chartPreferences ?? []).join('；')}

要承接的洞察：
${pool.map(i => `【${i.topic}】\n  發現：${i.keyFinding}\n  意涵：${i.implication}\n  建議：${i.recommendation}\n  圖表：${i.chartSuggestion}`).join('\n\n')}

可引用指標：
${metrics.map(m => `[${m.id}] ${m.name}`).join('\n')}

請設計 ${wanted} 頁。message 50 字內。`,
    10000, `section:${s.title}`,
  );

  const cp = (expanded?.pages ?? [])
    .filter(p => p?.pageTitle && !isPlaceholder(p.pageTitle))
    .slice(0, wanted)
    .map(p => ({ ...p, layout: 'content' }));

  const derived = cp.length ? cp : pool.slice(0, wanted).map(i => ({
    pageTitle: i.keyFinding.slice(0, 40), layout: 'content', message: i.keyFinding,
    elements: ['heading', 'chart', 'insight', 'source'],
    metricIds: metrics.slice(0, 2).map(m => m.id), insightTopics: [i.topic],
  }));

  sections.push({ title: s.title, purpose: s.purpose, pages: [
    { pageTitle: s.title, layout: 'section_title', message: pool[0]?.keyFinding ?? s.purpose, elements: ['title', 'subtitle'] },
    ...derived,
  ]});
}

const blueprint = { totalPages: sections.reduce((n, s) => n + s.pages.length, 0), narrative: outline?.narrative, sections };
const pages = sections.flatMap(s => (s.pages ?? []).filter(p => p?.pageTitle && !isPlaceholder(p.pageTitle)));

check('pipeline', 'blueprint has sections', sections.length >= 3, `${sections.length} sections`);
check('pipeline', 'page count honours the requested 14', Math.abs(pages.length - 14) <= 2, `${pages.length} pages`);
check('pipeline', 'page 1 is cover', pages[0]?.layout === 'cover', pages[0]?.layout);
check('pipeline', 'page 2 is toc', pages[1]?.layout === 'toc', pages[1]?.layout);
check('pipeline', 'last page is backcover', pages.at(-1)?.layout === 'backcover', pages.at(-1)?.layout);
// Structural pages legitimately have short titles (目錄, 結語); only content
// pages must state a finding rather than a bare label.
const LABEL_ONLY = /^(數據分析|市占率|分析|圖表|數據|結論|概況|說明)$/;
const contentTitles = pages.filter(p => p.layout === 'content').map(p => p.pageTitle);
check('pipeline', 'content titles state a finding, not a label',
  contentTitles.every(t => t.length >= 8 && !LABEL_ONLY.test(t)),
  `${contentTitles.length} content pages`);
check('pipeline', 'content titles mostly cite a number',
  contentTitles.filter(t => /\d/.test(t)).length >= Math.ceil(contentTitles.length * 0.6),
  `${contentTitles.filter(t => /\d/.test(t)).length}/${contentTitles.length} with numbers`);
check('pipeline', 'every page states its message',
  pages.every(p => p.message && !isPlaceholder(p.message)));
check('pipeline', 'content pages have 3+ elements',
  pages.filter(p => p.layout === 'content').every(p => (p.elements ?? []).length >= 3));
check('pipeline', 'sections precede their content',
  sections.every(s => {
    const ls = s.pages.map(p => p.layout);
    const st = ls.indexOf('section_title');
    return st < 0 || ls.slice(st + 1).includes('content');
  }));

// ═══ STAGE 4: plan screen shape ═══
stage('STAGE 4  plan → convert pipeline result for the plan screen');

const plan = {
  formulas: metrics.map(m => ({ id: m.id, name: m.name, definition: m.definition, supported: true })),
  unsupported,
  assumptions: [
    `報告對象：${brief?.audience}`,
    `報告目的：${brief?.purpose}`,
    brief?.requestedPageCount ? `頁數：依需求指定 ${brief.requestedPageCount} 頁` : '頁數：由系統規劃',
    ...(brief?.designDirectives ?? []).map(d => `版面要求：${d}`),
    ...(brief?.narrativeStyle ?? []).map(d => `文字風格：${d}`),
    ...(brief?.chartPreferences ?? []).map(d => `圖表偏好：${d}`),
    ...(brief?.constraints ?? []).map(d => `限制：${d}`),
  ],
  suggestedSlides: pages.map(p => p.pageTitle),
  insights: insights.map(i => ({
    topic: i.topic, keyFinding: i.keyFinding,
    implication: i.implication, recommendation: i.recommendation,
  })),
};

// Some requested metrics may legitimately land in unsupported, so the plan is
// judged on total coverage rather than on the supported count alone.
check('plan', 'plan accounts for every requested metric',
  plan.formulas.length + plan.unsupported.length >= requested.length,
  `${plan.formulas.length} supported + ${plan.unsupported.length} unsupported vs ${requested.length} requested`);
check('plan', 'insights card populated', plan.insights.length >= 3, `${plan.insights.length}`);
check('plan', 'directives surfaced in assumptions',
  plan.assumptions.some(a => a.startsWith('版面要求')) &&
  plan.assumptions.some(a => a.startsWith('圖表偏好')),
  `${plan.assumptions.length} assumptions`);
check('plan', 'slide list matches blueprint', plan.suggestedSlides.length === pages.length);

// ═══ STAGE 5: slide spec from blueprint ═══
stage('STAGE 5  preview → build slide spec from the blueprint');

const chartKeyFor = s => s === 'bar' ? 'ranking_latest'
  : s === 'line' ? 'market_share_trend' : 'mom_trend';

const slideSpecs = pages.map((p, i) => {
  const insight = insights.find(x => (p.insightTopics ?? []).includes(x.topic));
  const bg = p.layout === 'content' || p.layout === 'toc' ? '002'
    : p.layout === 'backcover' ? '003' : '001';
  const elements = [];

  if (p.layout === 'cover' || p.layout === 'section_title' || p.layout === 'backcover') {
    elements.push({ type: 'title', content: p.pageTitle });
    elements.push({ type: 'subtitle', content: p.message });
  } else if (p.layout === 'toc') {
    elements.push({ type: 'title', content: '目錄' });
    elements.push({ type: 'bullet_list', items: sections.map(s => s.title) });
  } else {
    elements.push({ type: 'heading', content: p.pageTitle });
    for (const el of p.elements ?? []) {
      if (el === 'chart') {
        elements.push({
          type: 'chart',
          chartType: insight?.chartSuggestion === 'bar' ? 'bar' : 'line',
          dataKey: chartKeyFor(insight?.chartSuggestion),
        });
      } else if (el === 'kpi_block') {
        elements.push({ type: 'kpi_block', metrics: [
          { label: '台新市占率', value: `${taishin.amountShare}%`, rank },
          { label: '月增率', value: `${mom > 0 ? '+' : ''}${mom}%`, trend: mom > 0 ? '↑' : '↓' },
        ]});
      } else if (el === 'comparison') {
        elements.push({ type: 'comparison', entities: computed.slice(0, 5).map(c => ({
          name: c.bank, value: `${c.amountShare}%`, highlight: c.bank.includes('台新'),
        }))});
      } else if (el === 'insight' && insight) {
        elements.push({ type: 'insight', content: insight.implication });
      } else if (el === 'text_block' && insight) {
        elements.push({ type: 'text_block', content: insight.recommendation });
      } else if (el === 'bullet_list') {
        elements.push({ type: 'bullet_list', items: insights.slice(0, 3).map(x => x.recommendation) });
      } else if (el === 'table') {
        elements.push({ type: 'table',
          headers: ['銀行', '市占率', '排名'],
          rows: computed.slice(0, 5).map((c, j) => [c.bank, `${c.amountShare}%`, String(j + 1)]) });
      } else if (el === 'source') {
        elements.push({ type: 'source', content: '金管會信用卡重要資訊揭露 114年1-12月' });
      }
    }
  }
  return { page: i + 1, background: bg, layout: p.layout, section: p.pageTitle, elements };
});

check('spec', 'spec page count matches blueprint', slideSpecs.length === pages.length, `${slideSpecs.length}`);
check('spec', 'page numbers sequential from 1',
  slideSpecs.every((s, i) => s.page === i + 1));
check('spec', 'cover uses background 001', slideSpecs[0].background === '001');
check('spec', 'content pages use background 002',
  slideSpecs.filter(s => s.layout === 'content').every(s => s.background === '002'));
check('spec', 'backcover uses background 003',
  slideSpecs.at(-1).background === '003', slideSpecs.at(-1).background);
check('spec', 'every page has elements', slideSpecs.every(s => s.elements.length > 0));
const chartPages = slideSpecs.filter(s => s.elements.some(e => e.type === 'chart'));
check('spec', 'deck contains charts', chartPages.length > 0, `${chartPages.length} chart pages`);
check('spec', 'chart pages cite a source',
  chartPages.every(s => s.elements.some(e => e.type === 'source')));
const numbersInDeck = JSON.stringify(slideSpecs).match(/10\.67|11\.62/g) ?? [];
check('spec', 'computed values reached the deck', numbersInDeck.length > 0, `${numbersInDeck.length} refs`);

// ═══ STAGE 6: export ═══
stage('STAGE 6  exporting → PPTX structure');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
for (const s of slideSpecs) {
  const sl = pptx.addSlide();
  sl.background = { color: s.background === '002' ? 'FFFFFF' : 'F8E8E8' };
  let y = 0.75;
  for (const el of s.elements) {
    if (el.type === 'title') {
      sl.addText(el.content, { x: 0.85, y: 2.9, w: 11.6, h: 1.6, fontSize: 40, bold: true, align: 'center', valign: 'middle', color: '2C3E50' });
    } else if (el.type === 'subtitle') {
      sl.addText(el.content, { x: 0.85, y: 4.6, w: 11.6, h: 0.8, fontSize: 16, align: 'center', color: '7F8C8D' });
    } else if (el.type === 'heading') {
      sl.addText(el.content, { x: 0.85, y, w: 11.6, h: 0.55, fontSize: 22, bold: true, color: 'C0392B' }); y += 0.85;
    } else if (el.type === 'chart') {
      sl.addChart(el.chartType, [{ name: '台新銀行', labels: periods, values: periods.map(() => taishin.amountShare) }],
        { x: 0.85, y, w: 6.7, h: 3.4, title: el.dataKey, showTitle: true, chartColors: ['C01B2B'] });
      y += 3.6;
    } else if (el.type === 'kpi_block') {
      for (const m of el.metrics) {
        sl.addText(`${m.value}\n${m.label}`, { x: 8, y, w: 3, h: 0.8, fontSize: 16, bold: true, align: 'center', fill: { color: 'FDEDEC' } });
        y += 0.9;
      }
    } else if (el.type === 'table') {
      const rows = [el.headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: 'C0392B' } } })),
        ...el.rows.map(r => r.map(c => ({ text: c, options: {} })))];
      sl.addTable(rows, { x: 0.85, y, w: 11.6, h: rows.length * 0.32, fontSize: 10, border: { type: 'solid', pt: 0.5, color: 'D5DBDB' } });
      y += rows.length * 0.32 + 0.2;
    } else if (el.type === 'bullet_list') {
      sl.addText(el.items.map(t => ({ text: String(t), options: { fontSize: 12, bullet: { type: 'bullet' } } })),
        { x: 0.85, y, w: 11.6, h: el.items.length * 0.36 });
      y += el.items.length * 0.36 + 0.15;
    } else if (el.type === 'comparison') {
      sl.addText(el.entities.map(e => `${e.name} ${e.value}`).join('   '), { x: 0.85, y, w: 11.6, h: 0.6, fontSize: 12 });
      y += 0.75;
    } else if (el.type === 'insight' || el.type === 'text_block') {
      sl.addText(String(el.content), { x: 0.85, y, w: 11.6, h: 0.7, fontSize: 12, fill: { color: 'EAF7EE' } });
      y += 0.85;
    } else if (el.type === 'source') {
      sl.addText(`資料來源：${el.content}`, { x: 0.85, y: 6.9, w: 11.6, h: 0.3, fontSize: 9, italic: true, color: '7F8C8D' });
    }
  }
  if (s.layout !== 'cover') {
    sl.addText(String(s.page), { x: 12.3, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, align: 'right' });
  }
}

const buf = await pptx.write({ outputType: 'nodebuffer' });
const zip = await JSZip.loadAsync(buf);
const names = Object.keys(zip.files);
const slideFiles = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
const chartFiles = names.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));

check('export', 'valid OOXML package', names.includes('[Content_Types].xml'));
check('export', 'slide count matches deck', slideFiles.length === slideSpecs.length, `${slideFiles.length}`);
check('export', 'native charts (not images)', chartFiles.length > 0, `${chartFiles.length} charts`);
check('export', 'charts embed a workbook (Edit Data works)',
  names.some(n => n.startsWith('ppt/embeddings/')));
const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
check('export', 'cover title centred', s1.includes('anchor="ctr"') && s1.includes('algn="ctr"'));
check('export', '16:9 layout',
  (await zip.file('ppt/presentation.xml').async('string')).includes('12192000'));
check('export', 'deck is non-trivial', buf.length > 30000, `${(buf.length / 1024).toFixed(0)} KB`);

const allXml = (await Promise.all(slideFiles.map(f => zip.file(f).async('string')))).join('');
check('export', 'computed numbers present in PPTX', /10\.67|11\.62/.test(allXml));
check('export', 'no placeholder text in PPTX', !/>\.\.\.</.test(allXml));

// ═══ Summary ═══
console.log(`\n${'═'.repeat(64)}`);
const byStage = {};
for (const r of results) {
  byStage[r.stage] ??= { pass: 0, fail: 0 };
  byStage[r.stage][r.pass ? 'pass' : 'fail']++;
}
for (const [s, v] of Object.entries(byStage)) {
  console.log(`  ${s.padEnd(10)} ${v.pass} passed${v.fail ? `, ${v.fail} FAILED` : ''}`);
}
const failed = results.filter(r => !r.pass);
console.log(`\n  TOTAL: ${results.length - failed.length}/${results.length} passed | ${aiCalls} AI calls`);
if (failed.length) {
  console.log('\n  Failures:');
  failed.forEach(f => console.log(`    [${f.stage}] ${f.name} ${f.detail}`));
}
console.log('═'.repeat(64));

console.log('\nGenerated deck structure:');
for (const s of sections) {
  console.log(`  § ${s.title}`);
  for (const p of s.pages ?? []) {
    if (p?.pageTitle && !isPlaceholder(p.pageTitle)) console.log(`      [${p.layout}] ${p.pageTitle}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
