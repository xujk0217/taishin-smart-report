/**
 * Browser-side PPTX generation from a SlideSpec deck.
 *
 * Each slide gets the official Taishin template JPEG as its full-page
 * background, then elements are laid out on top. Charts are emitted as
 * native PowerPoint chart objects so users can hit "Edit Data".
 */
import PptxGenJS from 'pptxgenjs';
import { saveAs } from 'file-saver';
import type { SlideSpec, SlideElement, BackgroundTemplate } from '../types/slide-spec';
import type { ComputeResult, ChartDataSet } from './metric-engine';
import { resolveChart, traceElement } from './provenance';

// ─── Brand tokens ────────────────────────────────────────────
const BRAND = {
  primary: 'C0392B',
  primaryDark: '922B21',
  white: 'FFFFFF',
  text: '2C3E50',
  textLight: '7F8C8D',
  chartColors: ['C0392B', '2980B9', '27AE60', 'F39C12', '8E44AD', '16A085'],
  font: '微軟正黑體',
};

// 16:9 wide layout is 13.333" × 7.5"
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.85;
const CONTENT_W = SLIDE_W - MARGIN * 2;

const BG_FILES: Record<BackgroundTemplate, string> = {
  '001': '/template-slides/slide-cover.jpg',
  '002': '/template-slides/slide-content.jpg',
  '003': '/template-slides/slide-backcover.jpg',
};

/** Vertical cursor used while stacking elements down a content slide. */
interface Cursor {
  y: number;
}

/**
 * Fetches a template background and returns it as a data URL.
 * PptxGenJS needs base64 for images to be embedded reliably.
 */
async function loadBackground(bg: BackgroundTemplate): Promise<string | null> {
  try {
    const res = await fetch(BG_FILES[bg]);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Generates and downloads a .pptx from the deck spec.
 */
export async function exportPptx(
  slides: SlideSpec[],
  result: ComputeResult | null,
  fileName = '台新信用卡分析報告.pptx',
): Promise<void> {
  if (!slides || slides.length === 0) {
    throw new Error('沒有可匯出的投影片');
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '智匯數據簡報神器';
  pptx.company = '台新新光金控';
  pptx.subject = '信用卡市場分析報告';
  pptx.title = findTitle(slides) ?? '信用卡市場分析報告';

  // Preload the three backgrounds once instead of per slide.
  const backgrounds: Partial<Record<BackgroundTemplate, string | null>> = {};
  for (const bg of ['001', '002', '003'] as BackgroundTemplate[]) {
    backgrounds[bg] = await loadBackground(bg);
  }

  for (const spec of slides) {
    const slide = pptx.addSlide();
    const bgData = backgrounds[spec.background];

    if (bgData) {
      try {
        slide.addImage({ data: bgData, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
      } catch {
        // If image fails, use solid color fallback
        slide.background = { color: spec.background === '002' ? BRAND.white : 'F8E8E8' };
      }
    } else {
      slide.background = { color: spec.background === '002' ? BRAND.white : 'F8E8E8' };
    }

    const onDark = spec.background !== '002';

    if (spec.layout === 'cover' || spec.layout === 'section_title' || spec.layout === 'backcover') {
      renderCentered(slide, spec);
    } else {
      renderContent(slide, spec, result);
    }

    // Page number, skipped on cover.
    if (spec.layout !== 'cover') {
      slide.addText(String(spec.page), {
        x: SLIDE_W - 1.0, y: SLIDE_H - 0.5, w: 0.6, h: 0.3,
        fontSize: 10, fontFace: BRAND.font,
        color: onDark ? BRAND.white : BRAND.textLight,
        align: 'right',
      });
    }
  }

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  saveAs(blob, fileName);
}

function findTitle(slides: SlideSpec[]): string | undefined {
  for (const s of slides) {
    const t = s.elements.find(e => e.type === 'title');
    if (t?.content) return t.content;
  }
  return undefined;
}

// ─── Centered layouts (cover / section title / back cover) ───

function renderCentered(slide: any, spec: SlideSpec) {
  const title = spec.elements.find(e => e.type === 'title');
  const subtitle = spec.elements.find(e => e.type === 'subtitle');
  // Black titles on cover/section/backcover per user request
  const color = BRAND.text;
  const subColor = BRAND.textLight;

  const hasSub = Boolean(subtitle?.content);
  // Title box is vertically centered; subtitle sits directly under it.
  const titleH = 1.6;
  const titleY = hasSub ? SLIDE_H / 2 - titleH : SLIDE_H / 2 - titleH / 2;

  slide.addText(title?.content ?? spec.section ?? '', {
    x: MARGIN, y: titleY, w: CONTENT_W, h: titleH,
    fontSize: spec.layout === 'cover' ? 40 : 34,
    fontFace: BRAND.font, color, bold: true,
    align: 'center', valign: 'middle',
  });

  if (hasSub) {
    slide.addText(subtitle!.content!, {
      x: MARGIN, y: titleY + titleH + 0.1, w: CONTENT_W, h: 0.8,
      fontSize: 16, fontFace: BRAND.font,
      color: subColor,
      align: 'center', valign: 'top',
    });
  }

  // Remaining bullet/text elements below, still centered.
  const extras = spec.elements.filter(
    e => e.type !== 'title' && e.type !== 'subtitle',
  );
  let y = titleY + titleH + (hasSub ? 1.0 : 0.3);
  for (const el of extras) {
    if (el.type === 'bullet_list' && el.items?.length) {
      slide.addText(el.items.join('\n'), {
        x: MARGIN + 1.5, y, w: CONTENT_W - 3, h: 0.35 * el.items.length,
        fontSize: 14, fontFace: BRAND.font, color,
        align: 'center', lineSpacing: 22,
      });
      y += 0.35 * el.items.length + 0.2;
    } else if (el.content) {
      slide.addText(el.content, {
        x: MARGIN, y, w: CONTENT_W, h: 0.5,
        fontSize: 13, fontFace: BRAND.font, color, align: 'center',
      });
      y += 0.6;
    }
  }
}

// ─── Content layout ──────────────────────────────────────────

function renderContent(slide: any, spec: SlideSpec, result: ComputeResult | null) {
  const cursor: Cursor = { y: 0.75 };

  // Heading first if present, so the rest flows beneath it.
  const heading = spec.elements.find(e => e.type === 'heading');
  if (heading?.content) {
    slide.addText(heading.content, {
      x: MARGIN, y: cursor.y, w: CONTENT_W, h: 0.55,
      fontSize: 22, fontFace: BRAND.font, color: BRAND.primary, bold: true,
      valign: 'middle',
    });
    // Underline accent
    slide.addShape('rect' as any, {
      x: MARGIN, y: cursor.y + 0.58, w: 2.2, h: 0.04,
      fill: { color: BRAND.primary }, line: { type: 'none' },
    });
    cursor.y += 0.85;
  }

  const rest = spec.elements.filter(e => e !== heading);
  const charts = rest.filter(e => e.type === 'chart');
  const sideBySide = charts.length === 1 && rest.some(
    e => e.type === 'kpi_block' || e.type === 'comparison',
  );

  if (sideBySide) {
    renderChartWithSidebar(slide, rest, result, cursor);
  } else {
    for (const el of rest) {
      if (cursor.y > SLIDE_H - 0.8) break;
      renderElement(slide, el, result, cursor, MARGIN, CONTENT_W);
    }
  }
}

/** Chart on the left, KPI/comparison stacked on the right. */
function renderChartWithSidebar(
  slide: any,
  elements: SlideElement[],
  result: ComputeResult | null,
  cursor: Cursor,
) {
  const chartEl = elements.find(e => e.type === 'chart')!;
  const chartW = CONTENT_W * 0.58;
  const sideX = MARGIN + chartW + 0.35;
  const sideW = CONTENT_W - chartW - 0.35;

  const chart = resolveChart(chartEl.dataKey, result);
  const chartTop = cursor.y;
  if (chart) {
    addNativeChart(slide, chart, MARGIN, chartTop, chartW, 3.6);
  } else {
    slide.addText('（無可用圖表資料）', {
      x: MARGIN, y: chartTop, w: chartW, h: 3.6,
      fontSize: 12, fontFace: BRAND.font, color: BRAND.textLight,
      align: 'center', valign: 'middle',
    });
  }

  // Sidebar
  const sideCursor: Cursor = { y: chartTop };
  for (const el of elements) {
    if (el === chartEl) continue;
    if (el.type === 'kpi_block' || el.type === 'comparison') {
      renderElement(slide, el, result, sideCursor, sideX, sideW);
    }
  }

  // Anything else runs full width below the chart.
  const belowCursor: Cursor = { y: Math.max(chartTop + 3.75, sideCursor.y + 0.1) };
  for (const el of elements) {
    if (el === chartEl) continue;
    if (el.type === 'kpi_block' || el.type === 'comparison') continue;
    if (belowCursor.y > SLIDE_H - 0.7) break;
    renderElement(slide, el, result, belowCursor, MARGIN, CONTENT_W);
  }
}

function renderElement(
  slide: any,
  el: SlideElement,
  result: ComputeResult | null,
  cursor: Cursor,
  x: number,
  w: number,
) {
  switch (el.type) {
    case 'title':
      slide.addText(el.content ?? '', {
        x, y: cursor.y, w, h: 0.6,
        fontSize: 26, fontFace: BRAND.font, color: BRAND.primary, bold: true,
      });
      cursor.y += 0.75;
      break;

    case 'subtitle':
      slide.addText(el.content ?? '', {
        x, y: cursor.y, w, h: 0.4,
        fontSize: 14, fontFace: BRAND.font, color: BRAND.textLight,
      });
      cursor.y += 0.5;
      break;

    case 'heading':
      slide.addText(el.content ?? '', {
        x, y: cursor.y, w, h: 0.45,
        fontSize: 18, fontFace: BRAND.font, color: BRAND.primary, bold: true,
      });
      cursor.y += 0.6;
      break;

    case 'chart': {
      const chart = resolveChart(el.dataKey, result);
      const h = Math.min(3.6, SLIDE_H - cursor.y - 0.9);
      if (chart && h > 1.2) {
        addNativeChart(slide, chart, x, cursor.y, w, h);
        cursor.y += h + 0.2;
      }
      break;
    }

    case 'text_block':
      if (el.content) {
        const h = estimateTextHeight(el.content, w, 12);
        slide.addText(el.content, {
          x, y: cursor.y, w, h,
          fontSize: 12, fontFace: BRAND.font, color: BRAND.text,
          valign: 'top', lineSpacing: 20,
        });
        cursor.y += h + 0.15;
      }
      break;

    case 'bullet_list': {
      const items = el.items ?? [];
      if (items.length === 0) break;
      const h = Math.min(items.length * 0.36 + 0.1, SLIDE_H - cursor.y - 0.7);
      slide.addText(
        items.map(t => ({
          text: t,
          options: {
            fontSize: 12, fontFace: BRAND.font, color: BRAND.text,
            bullet: { type: 'bullet' as const }, paraSpaceBefore: 4,
          },
        })) as any,
        { x, y: cursor.y, w, h, valign: 'top' },
      );
      cursor.y += h + 0.15;
      break;
    }

    case 'kpi_block': {
      const metrics = el.metrics ?? [];
      if (metrics.length === 0) break;
      // Sidebar (narrow) stacks vertically; full width lays out in a row.
      const vertical = w < CONTENT_W * 0.5;
      if (vertical) {
        for (const m of metrics.slice(0, 5)) {
          addKpiCard(slide, m, x, cursor.y, w, 0.72);
          cursor.y += 0.8;
        }
      } else {
        const count = Math.min(metrics.length, 5);
        const gap = 0.15;
        const cardW = (w - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          addKpiCard(slide, metrics[i], x + i * (cardW + gap), cursor.y, cardW, 0.95);
        }
        cursor.y += 1.1;
      }
      break;
    }

    case 'comparison': {
      const entities = el.entities ?? [];
      if (entities.length === 0) break;
      const vertical = w < CONTENT_W * 0.5;
      if (vertical) {
        for (const e of entities.slice(0, 6)) {
          slide.addText(`${e.name}　${e.value}`, {
            x, y: cursor.y, w, h: 0.36,
            fontSize: 11, fontFace: BRAND.font,
            color: e.highlight ? BRAND.primary : BRAND.text,
            bold: Boolean(e.highlight),
            fill: { color: e.highlight ? 'FDEDEC' : 'F4F6F6' },
            valign: 'middle',
          });
          cursor.y += 0.42;
        }
      } else {
        const count = Math.min(entities.length, 6);
        const gap = 0.12;
        const cellW = (w - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          const e = entities[i];
          slide.addText(`${e.name}\n${e.value}`, {
            x: x + i * (cellW + gap), y: cursor.y, w: cellW, h: 0.7,
            fontSize: 11, fontFace: BRAND.font,
            color: e.highlight ? BRAND.primary : BRAND.text,
            bold: Boolean(e.highlight),
            fill: { color: e.highlight ? 'FDEDEC' : 'F4F6F6' },
            align: 'center', valign: 'middle',
          });
        }
        cursor.y += 0.85;
      }
      break;
    }

    case 'insight':
      if (el.content) {
        const h = estimateTextHeight(el.content, w - 0.3, 12) + 0.1;
        slide.addText(`💡 ${el.content}`, {
          x, y: cursor.y, w, h,
          fontSize: 12, fontFace: BRAND.font, color: BRAND.text,
          fill: { color: 'EAF7EE' }, valign: 'middle',
          margin: 8,
        });
        cursor.y += h + 0.15;
      }
      break;

    case 'table': {
      const headers = el.headers ?? [];
      const rows = el.rows ?? [];
      if (headers.length === 0 && rows.length === 0) break;
      const tableRows = [
        headers.map(h => ({
          text: h,
          options: { bold: true, color: BRAND.white, fill: { color: BRAND.primary } },
        })),
        ...rows.map(r => r.map(c => ({ text: c, options: {} }))),
      ];
      const h = Math.min((tableRows.length) * 0.32, SLIDE_H - cursor.y - 0.7);
      slide.addTable(tableRows as any, {
        x, y: cursor.y, w, h,
        fontSize: 10, fontFace: BRAND.font, color: BRAND.text,
        border: { type: 'solid', pt: 0.5, color: 'D5DBDB' },
        valign: 'middle',
      });
      cursor.y += h + 0.2;
      break;
    }

    case 'source': {
      // Enrich the footnote with real cell references when we can find them.
      const prov = traceElement(el, result);
      const detail = prov.sources.length
        ? `　（${[...new Set(prov.sources.map(s => s.sheetName))].slice(0, 2).join('、')}）`
        : '';
      slide.addText(`資料來源：${el.content ?? '使用者上傳之 Excel'}${detail}`, {
        x, y: Math.min(cursor.y, SLIDE_H - 0.55), w, h: 0.3,
        fontSize: 9, fontFace: BRAND.font, color: BRAND.textLight, italic: true,
      });
      cursor.y += 0.35;
      break;
    }

    default:
      if (el.content) {
        slide.addText(el.content, {
          x, y: cursor.y, w, h: 0.4,
          fontSize: 11, fontFace: BRAND.font, color: BRAND.text,
        });
        cursor.y += 0.5;
      }
  }
}

function addKpiCard(
  slide: any,
  m: { label: string; value: string; rank?: number; trend?: string },
  x: number, y: number, w: number, h: number,
) {
  slide.addShape('roundRect' as any, {
    x, y, w, h,
    fill: { color: 'FDEDEC' },
    line: { color: 'F5B7B1', width: 0.75 },
    rectRadius: 0.06,
  });
  slide.addText(m.value, {
    x, y: y + 0.06, w, h: h * 0.52,
    fontSize: h > 0.8 ? 20 : 16, fontFace: BRAND.font,
    color: BRAND.primary, bold: true, align: 'center', valign: 'middle',
  });
  const sub = [m.label, m.rank ? `#${m.rank}` : '', m.trend ?? '']
    .filter(Boolean).join(' ');
  slide.addText(sub, {
    x, y: y + h * 0.55, w, h: h * 0.4,
    fontSize: 9, fontFace: BRAND.font, color: BRAND.textLight,
    align: 'center', valign: 'middle',
  });
}

function addNativeChart(
  slide: any,
  chart: ChartDataSet,
  x: number, y: number, w: number, h: number,
) {
  const data = chart.series.map(s => ({
    name: s.name,
    labels: chart.categories,
    values: s.data,
  }));

  slide.addChart(chart.type as any, data, {
    x, y, w, h,
    title: chart.title,
    showTitle: true,
    titleFontSize: 12,
    titleFontFace: BRAND.font,
    titleColor: BRAND.text,
    showLegend: chart.series.length > 1,
    legendPos: 'b',
    legendFontSize: 9,
    legendFontFace: BRAND.font,
    chartColors: chart.series.map(
      (s, i) => (s.color ?? BRAND.chartColors[i % BRAND.chartColors.length]).replace('#', ''),
    ),
    catAxisLabelFontSize: 9,
    catAxisLabelFontFace: BRAND.font,
    catAxisLabelRotate: chart.categories.length > 8 ? 45 : 0,
    valAxisLabelFontSize: 9,
    valAxisLabelFontFace: BRAND.font,
    valAxisLabelFormatCode: '0.0"%"',
    barDir: 'col',
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 5,
    lineSmooth: true,
    dataBorder: { pt: 0, color: 'FFFFFF' },
  });
}

/** Rough height estimate so text blocks don't overlap. */
function estimateTextHeight(text: string, widthIn: number, fontPt: number): number {
  // ~2 CJK chars per 0.1" at 12pt; keep it conservative.
  const charsPerLine = Math.max(10, Math.floor((widthIn * 72) / (fontPt * 0.95)));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return Math.min(lines * (fontPt / 72) * 1.7 + 0.1, 2.6);
}
