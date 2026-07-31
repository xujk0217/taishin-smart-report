// Test plan-adjuster logic with real API
const KEY = 'sk-mLTguli7F5n6BjcjanzcfSCi3B9o4o8SN6oFLYZ7tdKJs6C0n3Jrp4EJaDduYHbF';
const URL = 'https://opencode.ai/zen/v1/chat/completions';

const formulas = [
  { id: 'f1', name: '簽帳金額市占率', definition: '個別/總和×100', supported: true },
  { id: 'f2', name: '月增率', definition: '(本期-前期)/前期×100', supported: true },
  { id: 'f3', name: '排名', definition: '依大小排列', supported: true },
];
const slides = ['封面', '市占率趨勢', '排名比較', '月增率分析', '結論'];

const SYSTEM = `你是分析計劃調整助理。根據使用者要求修改計劃。
回傳JSON：{"formulas":[...],"suggestedSlides":[...],"explanation":"說明"}
保留沒被提到的項目不變。回傳純JSON。`;

const instruction = '加一頁「流通卡數比較」在排名比較後面，然後把月增率分析移到最後';

console.log('Testing plan adjustment...');
const start = Date.now();
const controller = new AbortController();
setTimeout(() => controller.abort(), 60000);

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
  body: JSON.stringify({
    model: 'deepseek-v4-flash-free',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `目前指標：${JSON.stringify(formulas)}\n目前投影片：${JSON.stringify(slides)}\n要求：${instruction}` },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  }),
  signal: controller.signal,
});

const data = await res.json();
const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
console.log(`Status: ${res.status} | ${Date.now()-start}ms | ${data.usage?.total_tokens} tokens`);

try {
  let t = content; const s = t.indexOf('{'), e = t.lastIndexOf('}')+1;
  if (s >= 0) t = t.slice(s, e);
  const result = JSON.parse(t);
  console.log(`✅ Slides: ${JSON.stringify(result.suggestedSlides || result.slides)}`);
  console.log(`   Explanation: ${result.explanation}`);
  const hasNewSlide = (result.suggestedSlides || result.slides || []).some(s => s.includes('流通卡'));
  console.log(`   Contains 流通卡數比較: ${hasNewSlide ? '✅' : '❌'}`);
} catch (e) {
  console.log(`❌ Parse failed: ${e.message}`);
  console.log(`Content: ${content.slice(0, 300)}`);
}
process.exit(0);
