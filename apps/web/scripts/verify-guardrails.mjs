/**
 * Verifies the slide-edit guardrails reject changes to protected content.
 * Mirrors validateEdit() from src/utils/slide-editor.ts.
 */

function extractNumbers(value) {
  const out = [];
  const walk = v => {
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'string') {
      const f = v.match(/-?\d+(?:\.\d+)?/g);
      if (f) out.push(...f.map(Number));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out.sort((a, b) => a - b);
}

const sameNumbers = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-9);
const PROTECTED_TYPES = new Set(['chart', 'kpi_block', 'comparison', 'table', 'source']);

function stripNarrative(el) {
  if (el.type === 'bullet_list') return el.items ?? [];
  if (el.type === 'kpi_block') return el.metrics ?? [];
  if (el.type === 'comparison') return el.entities ?? [];
  if (el.type === 'table') return el.rows ?? [];
  if (el.type === 'chart') return [];
  return el.content ?? '';
}

function validateEdit(original, proposed) {
  const v = [];
  if (!proposed || typeof proposed !== 'object') return [{ code: 'INVALID_SHAPE' }];
  if (!Array.isArray(proposed.elements)) return [{ code: 'INVALID_SHAPE' }];
  if (proposed.elements.length !== original.elements.length) return [{ code: 'DATA_ELEMENT_REMOVED' }];

  for (let i = 0; i < original.elements.length; i++) {
    const before = original.elements[i], after = proposed.elements[i];
    if (before.type !== after?.type) { v.push({ code: 'ELEMENT_TYPE_CHANGED' }); continue; }
    const checked = ['text_block','insight','bullet_list','heading','title','subtitle'];
    if (PROTECTED_TYPES.has(before.type) || checked.includes(before.type)) {
      if (!sameNumbers(extractNumbers(stripNarrative(before)), extractNumbers(stripNarrative(after)))) {
        v.push({ code: 'NUMBER_CHANGED' });
      }
    }
    if (before.type === 'chart') {
      if (before.dataKey !== after.dataKey) v.push({ code: 'CHART_REBOUND' });
      if (before.chartType !== after.chartType) v.push({ code: 'CHART_REBOUND' });
    }
    if (before.type === 'kpi_block') {
      const rb = (before.metrics ?? []).map(m => m.rank ?? null);
      const ra = (after.metrics ?? []).map(m => m.rank ?? null);
      if (JSON.stringify(rb) !== JSON.stringify(ra)) v.push({ code: 'RANK_CHANGED' });
    }
    if (before.type === 'source' && !after.content?.trim()) v.push({ code: 'SOURCE_REMOVED' });
  }
  return v;
}

const base = {
  page: 3, background: '002', layout: 'content', section: '市場競爭',
  elements: [
    { type: 'heading', content: '簽帳金額市占率趨勢' },
    { type: 'chart', chartType: 'line', dataKey: 'market_share_trend' },
    { type: 'kpi_block', metrics: [
      { label: '台新銀行', value: '10.67%', rank: 5 },
      { label: '中國信託', value: '18.50%', rank: 1 },
    ]},
    { type: 'insight', content: '台新市占率 10.67%，排名第 5。' },
    { type: 'bullet_list', items: ['12月月增率 +11.62%', '市場前三名合計 49%'] },
    { type: 'source', content: '金管會信用卡重要資訊揭露' },
  ],
};

const clone = o => JSON.parse(JSON.stringify(o));
const cases = [];
function testCase(name, mutate, expectCode) {
  const proposed = clone(base);
  mutate(proposed);
  const violations = validateEdit(base, proposed);
  const codes = violations.map(v => v.code);
  const pass = expectCode === null
    ? violations.length === 0
    : codes.includes(expectCode);
  cases.push({ name, pass, detail: expectCode === null
    ? (pass ? 'allowed' : `unexpectedly blocked: ${codes.join(',')}`)
    : (pass ? `blocked with ${expectCode}` : `expected ${expectCode}, got ${codes.join(',') || 'none'}`) });
}

// ── Should be ALLOWED: pure rewording ──
testCase('rephrase heading', p => { p.elements[0].content = '各銀行簽帳金額市占率變化'; }, null);
testCase('rephrase insight keeping numbers', p => {
  p.elements[3].content = '台新銀行以 10.67% 的市占率位居第 5 名。';
}, null);
testCase('reorder bullets keeping numbers', p => {
  p.elements[4].items = ['市場前三名合計 49%', '12月月增率 +11.62%'];
}, null);
testCase('rename section', p => { p.section = '市場競爭態勢'; }, null);
testCase('reword source annotation', p => {
  p.elements[5].content = '金管會信用卡業務重要資訊揭露統計';
}, null);

// ── Should be BLOCKED: number tampering ──
testCase('inflate KPI value', p => { p.elements[2].metrics[0].value = '12.67%'; }, 'NUMBER_CHANGED');
testCase('change number in insight', p => {
  p.elements[3].content = '台新市占率 15.20%，排名第 5。';
}, 'NUMBER_CHANGED');
testCase('change number in bullet', p => {
  p.elements[4].items = ['12月月增率 +25.00%', '市場前三名合計 49%'];
}, 'NUMBER_CHANGED');
testCase('alter ranking', p => { p.elements[2].metrics[0].rank = 1; }, 'RANK_CHANGED');
testCase('rebind chart dataKey', p => { p.elements[1].dataKey = 'ranking_latest'; }, 'CHART_REBOUND');
testCase('switch chart type', p => { p.elements[1].chartType = 'bar'; }, 'CHART_REBOUND');
testCase('empty the source annotation', p => { p.elements[5].content = ''; }, 'SOURCE_REMOVED');
testCase('drop the chart element', p => { p.elements.splice(1, 1); }, 'DATA_ELEMENT_REMOVED');
testCase('drop the KPI element', p => { p.elements.splice(2, 1); }, 'DATA_ELEMENT_REMOVED');
testCase('turn chart into text', p => { p.elements[1] = { type: 'text_block', content: '圖表說明' }; }, 'ELEMENT_TYPE_CHANGED');
testCase('add an extra element', p => { p.elements.push({ type: 'text_block', content: '補充' }); }, 'DATA_ELEMENT_REMOVED');
testCase('malformed response', () => {}, null); // placeholder replaced below
cases.pop();
{
  const violations = validateEdit(base, 'not an object');
  cases.push({ name: 'malformed AI response', pass: violations.some(v => v.code === 'INVALID_SHAPE'),
    detail: violations.map(v => v.code).join(',') });
}
{
  const violations = validateEdit(base, { page: 3 });
  cases.push({ name: 'response missing elements array', pass: violations.some(v => v.code === 'INVALID_SHAPE'),
    detail: violations.map(v => v.code).join(',') });
}

for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
const failed = cases.filter(c => !c.pass);
console.log(`\n${cases.length - failed.length}/${cases.length} guardrail checks passed`);
process.exit(failed.length ? 1 : 0);
