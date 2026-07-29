/**
 * Verifies the PPTX exporter produces a structurally valid deck.
 * Runs the same element-layout logic against PptxGenJS in Node and
 * inspects the resulting OOXML for native charts and per-slide parts.
 */
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const chart = {
  chartId: 'c1',
  title: '簽帳金額市占率趨勢',
  type: 'line',
  categories: ['11401', '11402', '11403', '11404'],
  series: [
    { name: '台新銀行', data: [10.2, 10.4, 10.5, 10.67], color: '#C01B2B' },
    { name: '中國信託', data: [18.1, 18.3, 18.4, 18.5], color: '#2E5090' },
  ],
  metricIds: [],
};

const deck = [
  { page: 1, layout: 'cover', background: '001', elements: [
    { type: 'title', content: '信用卡市場分析報告' },
    { type: 'subtitle', content: '15 家銀行 × 12 個月份' },
  ]},
  { page: 2, layout: 'section_title', background: '001', elements: [
    { type: 'title', content: '市場競爭分析' },
  ]},
  { page: 3, layout: 'content', background: '002', elements: [
    { type: 'heading', content: '簽帳金額市占率趨勢' },
    { type: 'chart', chartType: 'line', dataKey: 'market_share_trend' },
    { type: 'kpi_block', metrics: [
      { label: '台新銀行', value: '10.67%', rank: 5 },
      { label: '月增率', value: '+11.62%', trend: '↑' },
    ]},
    { type: 'insight', content: '前五大銀行合計市占超過 70%，市場集中度高。' },
    { type: 'source', content: '金管會信用卡重要資訊揭露' },
  ]},
  { page: 4, layout: 'content', background: '002', elements: [
    { type: 'heading', content: '結論與建議' },
    { type: 'bullet_list', items: ['台新市占穩定於 10-11%', '排名第 5', '建議深耕高消費族群'] },
    { type: 'table', headers: ['銀行', '市占率', '排名'], rows: [['台新', '10.67%', '5'], ['中信', '18.50%', '1']] },
  ]},
  { page: 5, layout: 'backcover', background: '003', elements: [
    { type: 'title', content: '謝謝' },
  ]},
];

const BRAND = { primary: 'C0392B', white: 'FFFFFF', text: '2C3E50', textLight: '7F8C8D', font: '微軟正黑體' };
const MARGIN = 0.85;
const CONTENT_W = SLIDE_W - MARGIN * 2;

function build() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = '信用卡市場分析報告';

  for (const spec of deck) {
    const s = pptx.addSlide();
    const onDark = spec.background !== '002';
    s.background = { color: onDark ? BRAND.primary : BRAND.white };

    if (spec.layout === 'content') {
      let y = 0.75;
      for (const el of spec.elements) {
        if (el.type === 'heading') {
          s.addText(el.content, { x: MARGIN, y, w: CONTENT_W, h: 0.55, fontSize: 22, bold: true, color: BRAND.primary });
          y += 0.85;
        } else if (el.type === 'chart') {
          s.addChart('line', chart.series.map(sr => ({ name: sr.name, labels: chart.categories, values: sr.data })), {
            x: MARGIN, y, w: CONTENT_W * 0.58, h: 3.6, title: chart.title, showTitle: true,
            chartColors: ['C01B2B', '2E5090'],
          });
          y += 3.8;
        } else if (el.type === 'kpi_block') {
          for (const m of el.metrics) {
            s.addShape('roundRect', { x: MARGIN, y, w: 2, h: 0.72, fill: { color: 'FDEDEC' }, line: { color: 'F5B7B1', width: 0.75 } });
            s.addText(m.value, { x: MARGIN, y, w: 2, h: 0.4, fontSize: 16, bold: true, color: BRAND.primary, align: 'center' });
            y += 0.8;
          }
        } else if (el.type === 'bullet_list') {
          s.addText(el.items.map(t => ({ text: t, options: { fontSize: 12, bullet: { type: 'bullet' } } })),
            { x: MARGIN, y, w: CONTENT_W, h: el.items.length * 0.36 });
          y += el.items.length * 0.36 + 0.15;
        } else if (el.type === 'table') {
          const rows = [
            el.headers.map(h => ({ text: h, options: { bold: true, color: BRAND.white, fill: { color: BRAND.primary } } })),
            ...el.rows.map(r => r.map(c => ({ text: c, options: {} }))),
          ];
          s.addTable(rows, { x: MARGIN, y, w: CONTENT_W, h: rows.length * 0.32, fontSize: 10,
            border: { type: 'solid', pt: 0.5, color: 'D5DBDB' } });
          y += rows.length * 0.32 + 0.2;
        } else if (el.type === 'insight') {
          s.addText('💡 ' + el.content, { x: MARGIN, y, w: CONTENT_W, h: 0.5, fontSize: 12, fill: { color: 'EAF7EE' } });
          y += 0.65;
        } else if (el.type === 'source') {
          s.addText('資料來源：' + el.content, { x: MARGIN, y, w: CONTENT_W, h: 0.3, fontSize: 9, italic: true, color: BRAND.textLight });
          y += 0.35;
        }
      }
    } else {
      const title = spec.elements.find(e => e.type === 'title');
      const sub = spec.elements.find(e => e.type === 'subtitle');
      const titleH = 1.6;
      const titleY = sub ? SLIDE_H / 2 - titleH : SLIDE_H / 2 - titleH / 2;
      s.addText(title?.content ?? '', {
        x: MARGIN, y: titleY, w: CONTENT_W, h: titleH,
        fontSize: spec.layout === 'cover' ? 40 : 34, bold: true,
        color: BRAND.white, align: 'center', valign: 'middle',
      });
      if (sub) {
        s.addText(sub.content, { x: MARGIN, y: titleY + titleH + 0.1, w: CONTENT_W, h: 0.8, fontSize: 16, align: 'center', color: BRAND.white });
      }
    }

    if (spec.layout !== 'cover') {
      s.addText(String(spec.page), { x: SLIDE_W - 1.0, y: SLIDE_H - 0.5, w: 0.6, h: 0.3, fontSize: 10, align: 'right' });
    }
  }
  return pptx;
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
}

const pptx = build();
const buf = await pptx.write({ outputType: 'nodebuffer' });
const zip = await JSZip.loadAsync(buf);
const names = Object.keys(zip.files);

// 1. Valid OOXML package
check('OOXML package has [Content_Types].xml', names.includes('[Content_Types].xml'));
check('presentation.xml present', names.includes('ppt/presentation.xml'));

// 2. Slide count matches deck
const slideFiles = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
check(`slide count = ${deck.length}`, slideFiles.length === deck.length, `got ${slideFiles.length}`);

// 3. Native chart object (not an image)
const chartFiles = names.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
check('native chart part exists', chartFiles.length >= 1, `got ${chartFiles.length}`);

if (chartFiles.length) {
  const chartXml = await zip.file(chartFiles[0]).async('string');
  check('chart is lineChart type', chartXml.includes('<c:lineChart>'));
  check('chart embeds series names', chartXml.includes('台新銀行') && chartXml.includes('中國信託'));
  check('chart embeds real values', chartXml.includes('10.67') && chartXml.includes('18.5'));
  check('chart has cached categories', chartXml.includes('11401') && chartXml.includes('11404'));
  // Editable charts need an embedded workbook
  const embedded = names.filter(n => n.startsWith('ppt/embeddings/'));
  check('chart has embedded workbook (Edit Data works)', embedded.length >= 1, `got ${embedded.length}`);
}

// 4. Native table (graphicFrame with a:tbl, not stacked textboxes)
const slide4 = await zip.file('ppt/slides/slide4.xml').async('string');
check('native table object on slide 4', slide4.includes('<a:tbl>'));
check('table headers present', slide4.includes('市占率') && slide4.includes('排名'));

// 5. Centered section title is vertically anchored
const slide2 = await zip.file('ppt/slides/slide2.xml').async('string');
check('section title vertically centered (anchor=ctr)', slide2.includes('anchor="ctr"'));
check('section title horizontally centered (algn=ctr)', slide2.includes('algn="ctr"'));
check('section title text present', slide2.includes('市場競爭分析'));

// 6. Cover has no page number, content pages do
const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
check('cover omits page number', !/>1<\/a:t>/.test(slide1));
const slide3 = await zip.file('ppt/slides/slide3.xml').async('string');
check('content page has page number', slide3.includes('>3</a:t>'));

// 7. Content elements survived onto the slide
check('KPI value rendered', slide3.includes('10.67%'));
check('insight text rendered', slide3.includes('市場集中度高'));
check('source footnote rendered', slide3.includes('金管會信用卡重要資訊揭露'));
check('bullet list rendered', slide4.includes('建議深耕高消費族群'));

// 8. 16:9 wide layout
const presXml = await zip.file('ppt/presentation.xml').async('string');
check('16:9 slide size (12192000 EMU wide)', presXml.includes('12192000'));

// 9. Non-trivial file size (real content, not an empty shell)
check('deck size > 20KB', buf.length > 20000, `${(buf.length / 1024).toFixed(0)} KB`);

const failed = checks.filter(c => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
