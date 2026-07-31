/**
 * Verifies the truncated-JSON recovery logic used by the AI pipeline.
 * Mirrors parseJSON/repairTruncatedJSON from src/utils/ai-pipeline.ts.
 */

function parseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
  }
  const s = cleaned.indexOf('{');
  if (s < 0) return null;
  cleaned = cleaned.slice(s);

  const e = cleaned.lastIndexOf('}') + 1;
  if (e > 0) {
    try { return JSON.parse(cleaned.slice(0, e)); } catch { }
  }
  return repairTruncatedJSON(cleaned);
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
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length <= 2) lastSafe = i;
    }
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
  while (open.length > 0) candidate += open.pop() === '{' ? '}' : ']';

  try { return JSON.parse(candidate); } catch { return null; }
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// 1. Well-formed JSON still parses
{
  const r = parseJSON('{"insights":[{"topic":"市占率","keyFinding":"台新 10.67%"}]}');
  check('well-formed JSON parses', r?.insights?.length === 1, `${r?.insights?.length} insights`);
}

// 2. Markdown-fenced JSON
{
  const r = parseJSON('```json\n{"insights":[{"topic":"排名"}]}\n```');
  check('markdown fence stripped', r?.insights?.[0]?.topic === '排名');
}

// 3. Leading prose before JSON
{
  const r = parseJSON('好的，以下是分析結果：\n{"insights":[{"topic":"成長"}]}');
  check('leading prose ignored', r?.insights?.[0]?.topic === '成長');
}

// 4. Truncated mid-object: keeps the complete elements
{
  const truncated = `{"insights":[
    {"topic":"市占率","keyFinding":"台新 10.67% 排名第五","recommendation":"鎖定玉山客群"},
    {"topic":"月增率","keyFinding":"12月 +11.62%","recommendation":"延續旺季操作"},
    {"topic":"有效卡率","keyFinding":"台新有效卡`;
  const r = parseJSON(truncated);
  check('truncated array recovers complete items', r?.insights?.length === 2, `${r?.insights?.length ?? 0} of 3 recovered`);
  check('recovered items keep their fields',
    r?.insights?.[0]?.keyFinding === '台新 10.67% 排名第五' && r?.insights?.[1]?.topic === '月增率');
}

// 5. Truncated blueprint with nested sections/pages
{
  const truncated = `{"totalPages":16,"narrative":"台新搶進前四的窗口","sections":[
    {"title":"開場","purpose":"掌握全局","pages":[
      {"pageTitle":"114年度分析","layout":"cover","message":"回顧表現","elements":["title"]},
      {"pageTitle":"目錄","layout":"toc","message":"三個部分","elements":["heading"]}
    ]},
    {"title":"市場定位","purpose":"確立競爭位置","pages":[
      {"pageTitle":"差距縮小至1.3個百分點","layout":"content","message":"台新對玉山","elements":["heading","chart"]}
    ]},
    {"title":"成長動能","purpose":"拆解成長來`;
  const r = parseJSON(truncated);
  check('truncated blueprint recovers sections', r?.sections?.length === 2, `${r?.sections?.length ?? 0} of 3 sections`);
  check('recovered blueprint keeps nested pages',
    r?.sections?.[0]?.pages?.length === 2 && r?.sections?.[1]?.pages?.length === 1);
  check('recovered blueprint keeps scalars', r?.totalPages === 16 && r?.narrative === '台新搶進前四的窗口');
}

// 6. Braces inside strings must not confuse the scanner
{
  const r = parseJSON('{"insights":[{"topic":"公式 {a} 說明","keyFinding":"含 } 括號"}]}');
  check('braces inside strings handled', r?.insights?.[0]?.topic === '公式 {a} 說明');
}

// 7. Escaped quotes inside strings
{
  const r = parseJSON('{"insights":[{"topic":"他說\\"很好\\"","keyFinding":"ok"}]}');
  check('escaped quotes handled', r?.insights?.[0]?.keyFinding === 'ok');
}

// 8. Unrecoverable input returns null rather than throwing
{
  const r = parseJSON('{"insights":[{"topic":"只有開頭');
  check('unrecoverable truncation returns null', r === null || (r?.insights?.length ?? 0) === 0,
    r === null ? 'null' : `${r?.insights?.length} insights`);
}
{
  const r = parseJSON('no json at all here');
  check('non-JSON returns null', r === null);
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
