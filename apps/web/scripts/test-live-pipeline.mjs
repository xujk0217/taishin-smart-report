/**
 * Runs the actual 4-step pipeline against the LIVE deployment's /api/ai proxy,
 * exactly as the browser would. This proves whether the deployed endpoint works.
 */
const BASE = 'https://dist-phi-flax-58.vercel.app';
const ENDPOINT = `${BASE}/api/ai`;

let callCount = 0;

async function aiCall(system, user, maxTokens = 6000, label = '') {
  callCount++;
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer proxy',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash-free',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
    }),
  });

  const elapsed = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`call#${callCount} ${label} HTTP ${res.status} after ${elapsed}ms: ${body.slice(0, 150)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning_content || '';
  console.log(`    call#${callCount} ${label}: ${res.status} in ${(elapsed / 1000).toFixed(1)}s, ${data.usage?.total_tokens ?? '?'} tokens`);
  if (!content) throw new Error(`call#${callCount} ${label} returned empty content`);
  return content;
}

function parseJSON(text) {
  let c = text.trim();
  if (c.startsWith('```')) c = c.split('\n').filter(l => !l.startsWith('```')).join('\n');
  const s = c.indexOf('{'), e = c.lastIndexOf('}') + 1;
  if (s >= 0 && e > s) c = c.slice(s, e);
  return JSON.parse(c);
}

const PROMPT = `分析台新信用卡114年度市場表現，包含簽帳金額市占率、流通卡數市占率、有效卡率、簽帳金額月增率、單卡平均消費力，並比較前五大銀行競爭態勢，產生給信用卡事業部主管的策略報告。`;

const EXCEL_SUMMARY = `📄 12 份月度 Excel（11401-11412）
  工作表「揭露.」: 47 列
  欄位: 金融機構名稱, 流通卡數, 有效卡數, 當月發卡數, 當月停卡數, 循環信用餘額, 未到期分期付款餘額, 當月簽帳金額, 當月預借現金金額, 逾期三個月以上比率, 逾期六個月以上比率, 備抵呆帳提足率, 當月轉銷呆帳金額, 當年度轉銷呆帳金額累計`;

const DATA_SUMMARY = `銀行數: 34
月份數: 12
前五名（11412 簽帳金額市占率）:
  中國信託商業銀行: 18.50% (排名1)
  國泰世華商業銀行: 18.05% (排名2)
  台北富邦商業銀行: 12.98% (排名3)
  玉山商業銀行: 11.97% (排名4)
  台新國際商業銀行: 10.67% (排名5)
台新簽帳金額月增率: +11.62%`;

const overall = Date.now();
console.log(`Testing live pipeline against ${ENDPOINT}\n`);

// ── Step 0: health check (what checkAIEndpoint does) ──
console.log('Step 0: endpoint health check');
{
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer proxy' },
    body: JSON.stringify({ model: 'deepseek-v4-flash-free', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
  });
  console.log(`    status ${res.status} in ${Date.now() - t0}ms`);
  if (res.status === 404) throw new Error('Proxy missing (404) — serverless function not deployed');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  console.log('    ✅ endpoint reachable\n');
}

// ── Step 1: Audience ──
console.log('Step 1: audience analysis');
const audienceRaw = await aiCall(
  `你是台新新光金控的策略顧問。分析使用者需求，判斷報告對象、目的、語氣、重點面向。
回傳 JSON：{"audience":"...","purpose":"...","tone":"...","focusAreas":["..."],"depth":"executive"}
只回傳 JSON。`,
  `使用者的需求：\n${PROMPT}\n\n資料概要：\n${EXCEL_SUMMARY}`,
  4000, 'audience',
);
const audience = parseJSON(audienceRaw);
console.log(`    ✅ 對象: ${audience.audience}`);
console.log(`       重點: ${(audience.focusAreas ?? []).join('、')}\n`);

// ── Step 2: Metrics (2 passes) ──
console.log('Step 2: metric discovery');
const extractRaw = await aiCall(
  `你是文字分析工具。從使用者需求中精確提取所有指標名稱，逐項列出不可省略。
回傳 JSON：{"requestedMetrics":["名稱1","名稱2"]}
只回傳 JSON。`,
  `使用者需求：\n${PROMPT}`,
  2000, 'extract',
);
const requested = parseJSON(extractRaw).requestedMetrics ?? [];
console.log(`    extracted ${requested.length} requests`);

const mapRaw = await aiCall(
  `你是金融數據分析專家。逐項回答每個指標能否計算。
可用欄位：流通卡數、有效卡數、當月發卡數、當月停卡數、循環信用餘額、未到期分期付款餘額、當月簽帳金額、當月預借現金金額、逾期比率、備抵呆帳提足率、轉銷呆帳金額。期間 11401-11412，34家銀行+總計。
回傳 JSON：{"metrics":[{"id":"m1","name":"","definition":"","category":"","supported":true,"relevanceToAudience":""}],"unsupported":[{"name":"","reason":""}]}
只回傳 JSON。`,
  `必須逐項回答的指標：\n${requested.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
  8000, 'map',
);
const mapped = parseJSON(mapRaw);
const supported = mapped.metrics ?? [];
const unsupported = mapped.unsupported ?? [];
console.log(`    ✅ ${supported.length} supported, ${unsupported.length} unsupported`);
console.log(`       coverage: ${supported.length + unsupported.length}/${requested.length}\n`);

// ── Step 3: Insights ──
console.log('Step 3: strategic insights');
const insightsRaw = await aiCall(
  `你是策略顧問。為每個分析主題產生洞察。
回傳 JSON：{"insights":[{"topic":"","keyFinding":"","dataPoints":[""],"implication":"","recommendation":"","chartSuggestion":"line"}]}
只回傳 JSON。`,
  `報告對象：${audience.audience}
重點面向：${(audience.focusAreas ?? []).join('、')}
可用指標：${supported.map(m => m.name).join('、')}
數據摘要：\n${DATA_SUMMARY}`,
  8000, 'insights',
);
const insights = parseJSON(insightsRaw).insights ?? [];
console.log(`    ✅ ${insights.length} insights`);
insights.slice(0, 3).forEach(i => console.log(`       【${i.topic}】${(i.keyFinding ?? '').slice(0, 50)}`));
console.log();

// ── Step 4: Architecture ──
console.log('Step 4: slide architecture');
const archRaw = await aiCall(
  `你是簡報架構設計師。設計完整簡報架構。
回傳 JSON：{"totalPages":12,"narrative":"","sections":[{"title":"","purpose":"","pages":[{"pageTitle":"","layout":"cover","purpose":"","contentPlan":[""]}]}]}
規則：第一頁 cover，第二頁 toc，最後 backcover，每段落有 section_title + content。總頁數 12-18。
只回傳 JSON。`,
  `報告對象：${audience.audience}（${audience.depth}）
重點面向：${(audience.focusAreas ?? []).join('、')}
指標：${supported.map(m => m.name).join('、')}
洞察：${insights.map(i => `【${i.topic}】${i.keyFinding}`).join('\n')}`,
  10000, 'architecture',
);
const arch = parseJSON(archRaw);
const pageCount = (arch.sections ?? []).reduce((sum, s) => sum + (s.pages?.length ?? 0), 0);
console.log(`    ✅ ${arch.sections?.length ?? 0} sections, ${pageCount} pages`);
console.log(`       narrative: ${arch.narrative}`);
(arch.sections ?? []).forEach(s => {
  console.log(`       § ${s.title} (${s.pages?.length ?? 0} 頁)`);
  (s.pages ?? []).forEach(p => console.log(`           - [${p.layout}] ${p.pageTitle}`));
});

console.log(`\n${'='.repeat(60)}`);
console.log(`RESULT: pipeline completed in ${((Date.now() - overall) / 1000).toFixed(0)}s using ${callCount} AI calls`);
console.log(`  audience:     ${audience.audience}`);
console.log(`  metrics:      ${supported.length} supported / ${unsupported.length} unsupported`);
console.log(`  insights:     ${insights.length}`);
console.log(`  architecture: ${pageCount} pages in ${arch.sections?.length ?? 0} sections`);
console.log('='.repeat(60));
process.exit(0);
