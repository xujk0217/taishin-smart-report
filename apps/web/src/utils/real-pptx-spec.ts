import type { AIPlanningOutputDto, CalculationSummary } from '@smart-report/contracts';
import type { SlideSpec } from '../types/slide-spec';
import type { TemplateChartData, TemplateExportData } from './template-exporter';

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function labelForRow(row: Record<string, unknown>, index: number, valueFields: string[]): string {
  const text = Object.entries(row).find(([field, value]) => !valueFields.includes(field) && typeof value === 'string' && value.trim())?.[1];
  return typeof text === 'string' ? text : `資料列 ${index + 1}`;
}

function valueForRow(row: Record<string, unknown>, valueFields: string[]): number | null {
  const plannedValue = valueFields.map(field => asNumber(row[field])).find((value): value is number => value !== null);
  return plannedValue ?? Object.values(row).map(asNumber).find((value): value is number => value !== null) ?? null;
}

function chartTypeFor(visualization: string): TemplateChartData['type'] {
  const instruction = visualization.toLowerCase();
  if (/pie|donut|圓餅|甜甜圈|占比|佔比|結構/.test(instruction)) return 'pie';
  if (/line|trend|time|時間|趨勢|走勢/.test(instruction)) return 'line';
  return 'bar';
}

function chartForTask(
  chartId: string,
  title: string,
  task: CalculationSummary['tasks'][number] | undefined,
  outputFields: string[],
  chartType: TemplateChartData['type'],
): TemplateChartData | null {
  if (!task) return null;
  const points = task.preview.slice(0, 12).map((row, index) => ({ label: labelForRow(row, index, outputFields), value: valueForRow(row, outputFields) }))
    .filter((point): point is { label: string; value: number } => point.value !== null);
  if (points.length === 0) return null;
  return {
    chartId,
    dataKey: chartId,
    title,
    type: chartType,
    categories: points.map(point => point.label),
    series: [{ name: task.metricId, data: points.map(point => point.value) }],
  };
}

function provenanceForChart(
  output: AIPlanningOutputDto,
  chartId: string,
): string {
  const chart = output.prompt_contract.charts.find(item => item.chart_id === chartId);
  const taskId = chart?.calculation_task_ids[0];
  const task = output.calculation_plan.tasks.find(item => item.task_id === taskId);
  const formula = output.formula_plan.formulas.find(item => item.formula_id === task?.formula_id);
  const bindings = task?.input_bindings.map(binding => `${binding.workbook_selector}／${binding.sheet_selector}／${binding.column_selector}`).join('；');
  return [
    bindings ? `實際來源：${bindings}` : '實際來源：計算產物',
    formula ? `公式：${formula.expression}` : undefined,
  ].filter(Boolean).join(' ｜ ');
}

export function createRealPptxSpec(
  output: AIPlanningOutputDto,
  calculationSummary: CalculationSummary,
): { slides: SlideSpec[]; data: TemplateExportData } {
  const charts = output.prompt_contract.charts.flatMap(chart => {
    const planTask = output.calculation_plan.tasks.find(item => item.task_id === chart.calculation_task_ids[0]);
    const task = calculationSummary.tasks.find(item => item.taskId === planTask?.task_id);
    const chartData = chartForTask(
      chart.chart_id,
      chart.title,
      task,
      planTask?.output_fields ?? [],
      chartTypeFor(chart.visualization),
    );
    return chartData ? [chartData] : [];
  });

  const slides: SlideSpec[] = output.deck_plan.slides.map(slide => {
    const slideCharts = slide.chart_ids.map(chartId => charts.find(chart => chart.chartId === chartId)).filter((chart): chart is TemplateChartData => Boolean(chart));
    const elements: SlideSpec['elements'] = [
      { type: 'title', content: slide.title, size: 'medium' },
      ...(slide.key_message ? [{ type: 'subtitle' as const, content: slide.key_message, size: 'small' as const }] : []),
      ...(slide.content_elements.length ? [{ type: 'bullet_list' as const, items: slide.content_elements.slice(0, 4), size: 'medium' as const }] : []),
      ...slideCharts.slice(0, 1).map(chart => ({ type: 'chart' as const, chartType: chart.type, dataKey: chart.chartId, size: 'large' as const })),
      ...slide.chart_ids.slice(0, 1).map(chartId => ({ type: 'source' as const, content: provenanceForChart(output, chartId), size: 'small' as const })),
    ];
    return {
      page: slide.page_number,
      background: slide.kind === 'cover' ? '001' : slide.kind === 'back-cover' ? '003' : '002',
      layout: slide.kind === 'cover' ? 'cover' : slide.kind === 'back-cover' ? 'backcover' : slide.kind === 'section' ? 'section_title' : 'content',
      section: slide.kind,
      elements,
    };
  });
  return { slides, data: { charts } };
}
