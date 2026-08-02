/**
 * PPTX Renderer - Generates native editable PowerPoint from SlideDeckSpec.
 * Uses PptxGenJS to create real chart objects and table objects (not images).
 */
import PptxGenJS from 'pptxgenjs';
import { BRAND_TOKENS } from './brand-tokens.js';

interface SlideSpec {
  slideIndex: number;
  layout: string;
  masterId: string;
  content: {
    title?: string;
    subtitle?: string;
    body?: string;
    claimIds?: string[];
    chart?: {
      type: string;
      chartDataSpecId: string;
      xAxis?: { label: string; format?: string; min?: number; max?: number };
      yAxis?: { label: string; min?: number; max?: number };
      series?: string[];
    };
    sourceHoverTargets?: { text: string; metricId: string }[];
  };
}

interface ChartDataSpec {
  chartDataSpecId: string;
  chartType: string;
  categories: string[];
  series: { name: string; values: number[] }[];
}

interface RenderInput {
  slideDeckSpec: {
    specId: string;
    jobId: string;
    slides: SlideSpec[];
  };
  chartDataSpecs: ChartDataSpec[];
}

interface RenderOutput {
  buffer: Buffer;
  slideCount: number;
  chartCount: number;
  tableCount: number;
}

/**
 * Render a PPTX file from SlideDeckSpec.
 * All charts are native editable PptxGenJS chart objects.
 * All tables are native PowerPoint table objects.
 */
export async function renderPptx(input: RenderInput): Promise<RenderOutput> {
  const pptx = new PptxGenJS();
  const { colors, fonts, slide, layout } = BRAND_TOKENS;

  // Configure presentation
  pptx.layout = 'LAYOUT_WIDE'; // 16:9
  pptx.author = '智匯數據簡報神器';
  pptx.subject = '信用卡市場分析報告';

  let chartCount = 0;
  let tableCount = 0;

  // Build chart data lookup
  const chartDataIndex = new Map<string, ChartDataSpec>();
  for (const spec of input.chartDataSpecs) {
    chartDataIndex.set(spec.chartDataSpecId, spec);
  }

  for (const slideSpec of input.slideDeckSpec.slides) {
    const pptxSlide = pptx.addSlide();

    switch (slideSpec.layout) {
      case 'cover':
        renderCoverSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      case 'toc':
        renderTocSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      case 'section':
        renderSectionSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      case 'chart':
        chartCount += renderChartSlide(pptxSlide, slideSpec, chartDataIndex, colors, fonts, layout);
        break;
      case 'table':
        tableCount += renderTableSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      case 'text':
        renderTextSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      case 'conclusion':
        renderConclusionSlide(pptxSlide, slideSpec, colors, fonts, layout);
        break;
      default:
        renderTextSlide(pptxSlide, slideSpec, colors, fonts, layout);
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

  return {
    buffer,
    slideCount: input.slideDeckSpec.slides.length,
    chartCount,
    tableCount,
  };
}

function renderCoverSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
) {
  // Background gradient
  slide.background = { fill: colors.primary };

  // Title
  if (spec.content.title) {
    slide.addText(spec.content.title, {
      x: 1,
      y: 1.8,
      w: 8,
      h: 1.2,
      fontSize: 36,
      fontFace: fonts.title,
      color: colors.secondary,
      bold: true,
      align: 'center',
    });
  }

  // Subtitle
  if (spec.content.subtitle) {
    slide.addText(spec.content.subtitle, {
      x: 1,
      y: 3.2,
      w: 8,
      h: 0.8,
      fontSize: 18,
      fontFace: fonts.body,
      color: colors.secondary,
      align: 'center',
    });
  }
}

function renderTocSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
) {
  slide.addText('目錄', {
    x: layout.marginLeft,
    y: layout.titleY,
    w: 9,
    h: 0.6,
    fontSize: fonts.titleSize,
    fontFace: fonts.title,
    color: colors.primary,
    bold: true,
  });

  if (spec.content.body) {
    slide.addText(spec.content.body, {
      x: layout.marginLeft,
      y: layout.contentY,
      w: 9,
      h: 4,
      fontSize: fonts.bodySize,
      fontFace: fonts.body,
      color: colors.text,
    });
  }
}

function renderSectionSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
) {
  slide.background = { fill: colors.accent };

  if (spec.content.title) {
    slide.addText(spec.content.title, {
      x: 1,
      y: 2,
      w: 8,
      h: 1.5,
      fontSize: 32,
      fontFace: fonts.title,
      color: colors.primary,
      bold: true,
      align: 'center',
    });
  }
}

function renderChartSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  chartDataIndex: Map<string, ChartDataSpec>,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
): number {
  // Title
  if (spec.content.title) {
    slide.addText(spec.content.title, {
      x: layout.marginLeft,
      y: layout.titleY,
      w: 9,
      h: 0.6,
      fontSize: fonts.titleSize,
      fontFace: fonts.title,
      color: colors.text,
      bold: true,
    });
  }

  // A chart-layout slide must resolve its declared ChartDataSpec. Silently
  // returning a chartless slide would make the artifact disagree with the
  // approved SlideDeckSpec.
  const chartSpec = spec.content.chart;
  if (!chartSpec) {
    throw new Error(`Chart slide ${spec.slideIndex} does not declare chart data`);
  }

  const chartData = chartDataIndex.get(chartSpec.chartDataSpecId);
  if (!chartData) {
    throw new Error(
      `Chart slide ${spec.slideIndex} references missing ChartDataSpec ${chartSpec.chartDataSpecId}`,
    );
  }

  // Map chart type to PptxGenJS chart type
  const chartTypeMap: Record<string, string> = {
    line: 'line',
    bar: 'bar',
    column: 'bar',
    pie: 'pie',
    doughnut: 'doughnut',
  };

  const pptxChartType = chartTypeMap[chartSpec.type] || 'line';

  // Build chart data for PptxGenJS
  const chartDataForPptx = chartData.series.map((s, idx) => ({
    name: s.name,
    labels: chartData.categories,
    values: s.values,
  }));

  const chartOpts: any = {
    x: layout.marginLeft,
    y: layout.contentY,
    w: 9,
    h: 4,
    showLegend: true,
    legendPos: 'b',
    legendFontSize: fonts.captionSize,
    chartColors: colors.chartColors.slice(0, chartData.series.length),
    catAxisLabelFontSize: fonts.chartLabelSize,
    valAxisLabelFontSize: fonts.chartLabelSize,
  };

  if (chartSpec.yAxis) {
    chartOpts.valAxisTitle = chartSpec.yAxis.label;
    if (chartSpec.yAxis.min !== undefined) chartOpts.valAxisMinVal = chartSpec.yAxis.min;
    if (chartSpec.yAxis.max !== undefined) chartOpts.valAxisMaxVal = chartSpec.yAxis.max;
  }
  if (chartSpec.xAxis) {
    chartOpts.catAxisTitle = chartSpec.xAxis.label;
  }

  // This creates a NATIVE chart object in PowerPoint (not an image!)
  slide.addChart(pptxChartType as any, chartDataForPptx, chartOpts);

  return 1;
}

function renderTableSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
): number {
  if (spec.content.title) {
    slide.addText(spec.content.title, {
      x: layout.marginLeft,
      y: layout.titleY,
      w: 9,
      h: 0.6,
      fontSize: fonts.titleSize,
      fontFace: fonts.title,
      color: colors.text,
      bold: true,
    });
  }

  // Create a native PowerPoint table (not text boxes!)
  // This would be populated from actual data in real implementation
  const tableData = [
    [
      { text: '銀行', options: { bold: true, fill: { color: colors.primary }, color: colors.secondary } },
      { text: '市占率', options: { bold: true, fill: { color: colors.primary }, color: colors.secondary } },
      { text: '排名', options: { bold: true, fill: { color: colors.primary }, color: colors.secondary } },
    ],
  ];

  slide.addTable(tableData, {
    x: layout.marginLeft,
    y: layout.contentY,
    w: 9,
    h: 3.5,
    fontSize: fonts.bodySize,
    fontFace: fonts.body,
    border: { type: 'solid', pt: 0.5, color: colors.accent },
    colW: [3, 3, 3],
  });

  return 1;
}

function renderTextSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
) {
  if (spec.content.title) {
    slide.addText(spec.content.title, {
      x: layout.marginLeft,
      y: layout.titleY,
      w: 9,
      h: 0.6,
      fontSize: fonts.titleSize,
      fontFace: fonts.title,
      color: colors.text,
      bold: true,
    });
  }

  if (spec.content.body) {
    slide.addText(spec.content.body, {
      x: layout.marginLeft,
      y: layout.contentY,
      w: 9,
      h: 4,
      fontSize: fonts.bodySize,
      fontFace: fonts.body,
      color: colors.text,
      valign: 'top',
    });
  }
}

function renderConclusionSlide(
  slide: PptxGenJS.Slide,
  spec: SlideSpec,
  colors: typeof BRAND_TOKENS.colors,
  fonts: typeof BRAND_TOKENS.fonts,
  layout: typeof BRAND_TOKENS.layout,
) {
  slide.background = { fill: colors.primary };

  slide.addText(spec.content.title || '結論與建議', {
    x: 1,
    y: 1.5,
    w: 8,
    h: 1,
    fontSize: 28,
    fontFace: fonts.title,
    color: colors.secondary,
    bold: true,
    align: 'center',
  });

  if (spec.content.body) {
    slide.addText(spec.content.body, {
      x: 1,
      y: 2.8,
      w: 8,
      h: 2.5,
      fontSize: 14,
      fontFace: fonts.body,
      color: colors.secondary,
      align: 'center',
    });
  }
}
