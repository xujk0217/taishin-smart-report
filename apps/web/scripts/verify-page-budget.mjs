/**
 * Verifies the outline is normalised to the requested page count.
 * Mirrors normaliseOutlineToBudget from src/utils/ai-pipeline.ts.
 *
 * Page accounting:
 *   opening → cover + toc + contentPages
 *   middle  → section_title + contentPages
 *   closing → backcover
 */

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
    if (widest.contentPages > 1) {
      widest.contentPages--;
    } else if (opening.contentPages > 0) {
      opening.contentPages = 0;
    } else if (middle.length > 1) {
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

/** Counts the pages the blueprint builder will actually emit. */
function realisedPages(sections) {
  if (sections.length < 2) return 0;
  const opening = sections[0];
  const middle = sections.slice(1, -1);
  return 2 + opening.contentPages
    + middle.reduce((n, s) => n + 1 + s.contentPages, 0)
    + 1;
}

const mk = (...counts) => [
  { title: '開場', purpose: '', contentPages: counts[0] },
  ...counts.slice(1, -1).map((c, i) => ({ title: `分析${i + 1}`, purpose: '', contentPages: c })),
  { title: '結語', purpose: '', contentPages: counts.at(-1) },
];

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// The failing real case: outline wanted 19, prompt asked for 14
{
  const s = mk(1, 3, 3, 3, 2, 0);
  const before = realisedPages(s);
  normaliseOutlineToBudget(s, 14);
  check('trims 19 pages down to 14', realisedPages(s) === 14, `${before} → ${realisedPages(s)}`);
}

// Needs to grow
{
  const s = mk(0, 1, 1, 0);
  const before = realisedPages(s);
  normaliseOutlineToBudget(s, 12);
  check('grows a thin outline up to 12', realisedPages(s) === 12, `${before} → ${realisedPages(s)}`);
}

// Already correct: must not change
{
  const s = mk(1, 3, 2, 2, 0);
  const snapshot = JSON.stringify(s);
  normaliseOutlineToBudget(s, 14);
  check('leaves a correct outline untouched',
    realisedPages(s) === 14 && JSON.stringify(s) === snapshot, `${realisedPages(s)} pages`);
}

// A range of targets should all be hit exactly
{
  let allOk = true;
  const misses = [];
  for (const target of [9, 10, 12, 14, 16, 18, 20]) {
    const s = mk(1, 3, 3, 3, 2, 0);
    normaliseOutlineToBudget(s, target);
    if (realisedPages(s) !== target) { allOk = false; misses.push(`${target}→${realisedPages(s)}`); }
  }
  check('hits every target from 9 to 20 exactly', allOk, misses.join(', ') || 'all exact');
}

// Very small target: sections get dropped rather than overshooting
{
  const s = mk(1, 3, 3, 3, 3, 3, 0);
  normaliseOutlineToBudget(s, 6);
  check('drops sections when the target is very small',
    realisedPages(s) === 6, `${realisedPages(s)} pages, ${s.length} sections`);
}

// No section is left empty, and none absorbs the whole deck
{
  const s = mk(1, 9, 9, 0);
  normaliseOutlineToBudget(s, 16);
  const mids = s.slice(1, -1);
  check('every section keeps at least one content page',
    mids.every(m => m.contentPages >= 1), mids.map(m => m.contentPages).join(','));
  check('content pages spread evenly rather than piling on one section',
    Math.max(...mids.map(m => m.contentPages)) - Math.min(...mids.map(m => m.contentPages)) <= 1,
    mids.map(m => m.contentPages).join(','));
  check('exact target with wide sections', realisedPages(s) === 16, `${realisedPages(s)} pages`);
}

// Malformed counts from the model must not break the maths
{
  const s = [
    { title: '開場', purpose: '', contentPages: undefined },
    { title: '分析', purpose: '', contentPages: 'three' },
    { title: '結語', purpose: '', contentPages: null },
  ];
  normaliseOutlineToBudget(s, 10);
  check('handles non-numeric page counts',
    Number.isFinite(realisedPages(s)) && realisedPages(s) === 10, `${realisedPages(s)} pages`);
}

// Closing section never carries content pages
{
  const s = mk(1, 3, 5);
  normaliseOutlineToBudget(s, 12);
  check('closing section has no content pages', s.at(-1).contentPages === 0);
}

// Degenerate input must not loop forever
{
  const s = [{ title: '只有一段', purpose: '', contentPages: 3 }];
  normaliseOutlineToBudget(s, 10);
  check('single-section outline returns safely', s.length === 1);
}

const failed = checks.filter(c => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
