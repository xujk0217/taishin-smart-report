/**
 * Test: does the 3-pass metric discovery find ALL 10 metrics user asked for?
 */
const KEY = 'sk-mLTguli7F5n6BjcjanzcfSCi3B9o4o8SN6oFLYZ7tdKJs6C0n3Jrp4EJaDduYHbF';
const URL = 'https://opencode.ai/zen/v1/chat/completions';

async function aiCall(system, user, maxTokens = 6000) {
  const c = new AbortController();
  setTimeout(() => c.abort(), 60000);
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'deepseek-v4-flash-free', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens }),
    signal: c.signal,
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
}

function parseJSON(text) {
  let c = text.trim();
  if (c.startsWith('```')) c = c.split('\n').filter(l => !l.startsWith('```')).join('\n');
  const s = c.indexOf('{'), e = c.lastIndexOf('}') + 1;
  if (s >= 0 && e > s) c = c.slice(s, e);
  return JSON.parse(c);
}

// Simulate user prompt with 10 explicit metrics
const USER_PROMPT = `分析台新信用卡114年度以下10個指標：
1. 簽帳金額市占率
2. 流通卡數市占率
3. 有效卡率（有效卡/流通卡）
4. 停卡率（當月停卡/流通卡）
5. 簽帳金額月增率(MoM)
6. 流通卡數月增率(MoM)
7. 單卡平均消費力（簽帳金額/有效卡數）
8. 循環信用使用率（循環信用餘額/簽帳金額）
9. 逾期風險指標（逾期三個月以上比率）
10. 呆帳轉銷率（當月轉銷呆帳/循環信用餘額）

另外也想看年增率(YoY)如果有113年資料的話。

並比較前五大銀行的表現差異。`;

console.log('=== Pass 1: Extract user requests ===');
const t1 = Date.now();
const extractResult = await aiCall(
  `你是文字分析工具。從使用者需求中精確提取所有指標名稱。逐項列出，不可省略。回傳JSON：{"requestedMetrics":["指標名1","指標名2","指標名3"]}。注意：不可用省略號，必須列出全部。只回傳JSON。`,
  `使用者需求：\n${USER_PROMPT}`,
  2000
);
const extracted = parseJSON(extractResult);
console.log(`  ${Date.now()-t1}ms | Found ${extracted.requestedMetrics.length} requests:`);
extracted.requestedMetrics.forEach((m, i) => console.log(`  ${i+1}. ${m}`));

console.log('\n=== Pass 2: Map each metric ===');
const MAP_SYSTEM = `你是金融數據分析專家。使用者要求的每一個指標，你必須逐項回答。

可用欄位（每月）：金融機構名稱、流通卡數(張)、有效卡數(張)、當月發卡數、當月停卡數、循環信用餘額(千元)、未到期分期付款餘額(千元)、當月簽帳金額(千元)、當月預借現金金額(千元)、逾期三個月以上比率(%)、逾期六個月以上比率(%)、備抵呆帳提足率(%)、當月轉銷呆帳金額(千元)、當年度轉銷呆帳金額累計(千元)。
期間：11401-11412。銀行：34家+總計。

回傳JSON：{"metrics":[{"id":"m1","name":"名稱","definition":"公式","category":"分類","supported":true,"relevanceToAudience":""}],"unsupported":[{"name":"名稱","reason":"原因"}]}
只回傳JSON。`;

const t2 = Date.now();
const mapResult = await aiCall(
  MAP_SYSTEM,
  `使用者明確要求的指標（必須逐項回答，不可跳過）：\n${extracted.requestedMetrics.map((m,i) => `${i+1}. ${m}`).join('\n')}`,
  8000
);
const mapped = parseJSON(mapResult);
console.log(`  ${Date.now()-t2}ms`);
console.log(`  Supported: ${mapped.metrics?.length ?? 0}`);
mapped.metrics?.forEach(m => console.log(`    ✅ ${m.name}: ${m.definition?.slice(0, 50)}`));
console.log(`  Unsupported: ${mapped.unsupported?.length ?? 0}`);
mapped.unsupported?.forEach(u => console.log(`    ❌ ${u.name}: ${u.reason}`));

// Check coverage
const total = (mapped.metrics?.length ?? 0) + (mapped.unsupported?.length ?? 0);
const requested = extracted.requestedMetrics.length;
console.log(`\n=== Coverage: ${total}/${requested} (${Math.round(total/requested*100)}%) ===`);
if (total >= requested) {
  console.log('✅ All user-requested metrics addressed!');
} else {
  console.log('❌ Some metrics missing — would trigger supplement pass');
}

process.exit(0);
