/**
 * Full E2E test with real 12 monthly Excel files.
 * Tests: read → merge → compute metrics → AI plan → AI slide spec
 */
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const KEY = 'sk-mLTguli7F5n6BjcjanzcfSCi3B9o4o8SN6oFLYZ7tdKJs6C0n3Jrp4EJaDduYHbF';
const URL = 'https://opencode.ai/zen/v1/chat/completions';
const MODEL = 'deepseek-v4-flash-free';

// ─── Step 1: Read all 12 Excel files ─────────────────────────
console.log('═══ Step 1: Reading 12 monthly Excel files ═══');
const dir = '../../114信用卡資料';
const files = readdirSync(dir).filter(f => f.endsWith('.xlsx')).sort();
console.log(`  Found ${files.length} files`);

const allData = []; // { period, bank, metrics: {...} }

for (const f of files) {
  // Extract period from filename
  const periodMatch = f.match(/(\d{5})/);
  let period = periodMatch ? periodMatch[1] : null;
  if (!period && f.includes('2月')) period = '11402';
  if (!period) continue;

  const buf = readFileSync(join(dir, f));
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Find header row (contains '金融機構名稱')
  let headerRow = 3;
  for (let r = 0; r <= 5; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell?.v && String(cell.v).includes('金融機構')) { headerRow = r; break; }
  }

  // Read headers
  const headers = [];
  for (let c = 0; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    headers.push(cell ? String(cell.v).trim().replace(/\s+/g, '') : `col${c}`);
  }

  // Read data rows
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const nameCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (!nameCell?.v) continue;
    const bankName = String(nameCell.v).trim();
    if (bankName.startsWith('一、') || bankName.startsWith('二、') || bankName.match(/^\d+\./)) continue;

    const row = { period, bank: bankName };
    for (let c = 1; c <= Math.min(range.e.c, 13); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v != null) {
        const key = headers[c] || `col${c}`;
        row[key] = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v).replace(/,/g, ''));
      }
    }
    allData.push(row);
  }
}

console.log(`  Total records: ${allData.length}`);
const periods = [...new Set(allData.map(d => d.period))].sort();
const banks = [...new Set(allData.map(d => d.bank))].filter(b => b !== '總計');
console.log(`  Periods: ${periods.join(', ')}`);
console.log(`  Banks: ${banks.length} (first 5: ${banks.slice(0, 5).join(', ')})`);

// ─── Step 2: Compute key metrics ─────────────────────────────
console.log('\n═══ Step 2: Computing metrics ═══');

// 簽帳金額 market share for latest period
const latestPeriod = periods[periods.length - 1];
const latestData = allData.filter(d => d.period === latestPeriod);
const totalRow = latestData.find(d => d.bank === '總計');
const totalAmount = totalRow?.['當月簽帳金額'] || 0;
const totalCards = totalRow?.['流通卡數'] || 0;

const bankMetrics = banks.map(bank => {
  const row = latestData.find(d => d.bank === bank);
  const amount = row?.['當月簽帳金額'] || 0;
  const cards = row?.['流通卡數'] || 0;
  return {
    bank,
    amountShare: totalAmount ? Math.round((amount / totalAmount) * 10000) / 100 : 0,
    cardShare: totalCards ? Math.round((cards / totalCards) * 10000) / 100 : 0,
    amount,
    cards,
  };
}).sort((a, b) => b.amountShare - a.amountShare);

console.log(`  Latest period: ${latestPeriod}`);
console.log(`  Total 簽帳金額: ${totalAmount.toLocaleString()}`);
console.log(`  Top 5 by 簽帳金額市占率:`);
bankMetrics.slice(0, 5).forEach((m, i) => {
  console.log(`    ${i+1}. ${m.bank}: ${m.amountShare}% (${m.amount.toLocaleString()}千元)`);
});

// Find 台新
const taishin = bankMetrics.find(m => m.bank.includes('台新'));
console.log(`\n  台新國際商業銀行:`);
console.log(`    簽帳金額市占率: ${taishin?.amountShare}%`);
console.log(`    排名: ${bankMetrics.indexOf(taishin) + 1}/${bankMetrics.length}`);

// MoM for 台新
const taishinData = allData.filter(d => d.bank?.includes('台新')).sort((a, b) => a.period.localeCompare(b.period));
if (taishinData.length >= 2) {
  const curr = taishinData[taishinData.length - 1]?.['當月簽帳金額'] || 0;
  const prev = taishinData[taishinData.length - 2]?.['當月簽帳金額'] || 0;
  const mom = prev ? Math.round(((curr - prev) / prev) * 10000) / 100 : 0;
  console.log(`    簽帳金額月增率(MoM): ${mom > 0 ? '+' : ''}${mom}%`);
}

// ─── Step 3: Build summary for AI ────────────────────────────
const dataSummary = `資料概要：
- 檔案數: ${files.length} 份月度 Excel
- 期間: ${periods[0]} ~ ${periods[periods.length-1]} (${periods.length} 個月)
- 銀行數: ${banks.length} 家
- 每月指標: 流通卡數、有效卡數、當月發卡數、當月停卡數、循環信用餘額、未到期分期付款餘額、當月簽帳金額、當月預借現金金額、逾期比率等 14 欄
- 金額單位: 新臺幣千元
- 卡數單位: 張

最新月份 (${latestPeriod}) 簽帳金額市占率 Top 5:
${bankMetrics.slice(0, 5).map((m, i) => `  ${i+1}. ${m.bank}: ${m.amountShare}%`).join('\n')}

台新國際商業銀行:
  簽帳金額市占率: ${taishin?.amountShare}% (排名 ${bankMetrics.indexOf(taishin)+1}/${bankMetrics.length})
  流通卡數市占率: ${taishin?.cardShare}%`;

console.log('\n═══ Step 3: AI Plan Generation ═══');

async function callAI(messages, maxTokens = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: maxTokens }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    return { content: msg?.content || msg?.reasoning_content || '', tokens: data.usage?.total_tokens ?? 0, finish: data.choices?.[0]?.finish_reason };
  } catch (e) { clearTimeout(timer); throw e; }
}

const planStart = Date.now();
const planRes = await callAI([
  { role: 'system', content: `你是台新新光金控的 AI 數據分析顧問。根據使用者上傳的信用卡月度統計 Excel 檔案結構，規劃分析方案。回傳純 JSON：
{"formulas":[{"id":"f1","name":"名稱","definition":"公式"}],"unsupported":[{"name":"名稱","reason":"原因"}],"assumptions":["假設"],"suggestedSlides":["頁面標題"]}` },
  { role: 'user', content: `${dataSummary}\n\n使用者需求：全面分析台新信用卡114年度市場表現，包含市占率趨勢、排名變化、競爭態勢、各項指標比較，產生主管級管理報告簡報。` }
], 4000);

console.log(`  ⏱ ${Date.now() - planStart}ms | ${planRes.tokens} tokens | finish: ${planRes.finish}`);
try {
  let t = planRes.content; const s = t.indexOf('{'), e = t.lastIndexOf('}')+1;
  if (s >= 0) t = t.slice(s, e);
  const plan = JSON.parse(t);
  console.log(`  ✅ Plan: ${plan.formulas?.length} formulas, ${plan.unsupported?.length} unsupported, ${plan.suggestedSlides?.length} slides`);
  plan.formulas?.slice(0, 5).forEach(f => console.log(`     · ${f.name}: ${f.definition?.slice(0, 50)}`));
} catch (e) { console.log(`  ❌ Parse failed: ${e.message}\n  Content: ${planRes.content.slice(0, 300)}`); }

// ─── Step 4: AI Slide Spec ───────────────────────────────────
console.log('\n═══ Step 4: AI Slide Spec Generation ═══');
const specStart = Date.now();
const specRes = await callAI([
  { role: 'system', content: `你是台新新光金控的專業簡報規劃 AI。為高階主管設計信用卡市場分析報告。

背景: "001"=封面/段落標題, "002"=內文, "003"=封底
版面: "cover", "section_title", "content", "backcover"
元素: "title","subtitle","heading","chart","text_block","bullet_list","kpi_block","insight","comparison","table","source"
chart的dataKey: "market_share_trend","ranking_latest","mom_trend","card_count_trend"

規則：8-12頁，content頁每頁3-5元素，圖表搭配insight+source，至少有kpi_block和comparison。
回傳純JSON：{"slides":[{"page":1,"background":"001","layout":"cover","elements":[...]},...]}` },
  { role: 'user', content: `${dataSummary}\n\n需求：台新信用卡114年度完整市場分析報告，10頁，包含市占率趨勢、排名、月增率、競爭比較、結論建議。` }
], 8000);

console.log(`  ⏱ ${Date.now() - specStart}ms | ${specRes.tokens} tokens | finish: ${specRes.finish}`);
try {
  let t = specRes.content; const s = t.indexOf('{'), e = t.lastIndexOf('}')+1;
  if (s >= 0) t = t.slice(s, e);
  const spec = JSON.parse(t);
  const slides = spec.slides || [];
  console.log(`  ✅ ${slides.length} slides generated:`);
  slides.forEach(sl => {
    const els = sl.elements?.map(e => e.type) ?? [];
    console.log(`     P${sl.page} ${sl.layout}(${sl.background}): ${els.join(', ')}`);
  });
} catch (e) {
  console.log(`  ❌ Parse failed: ${e.message}`);
  console.log(`  Length: ${specRes.content.length}, finish: ${specRes.finish}`);
  console.log(`  Last 200: ${specRes.content.slice(-200)}`);
}

console.log('\n═══ DONE ═══');
process.exit(0);
