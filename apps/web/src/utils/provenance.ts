/**
 * Provenance index: links every slide element back to the metrics that
 * produced it, and from there to the exact Excel cells.
 *
 * Chain: SlideElement → MetricRecord[] → SourceRef[] → (file, sheet, cell)
 *
 * This is what powers the evidence panel and the data-inspection tab.
 */
import type { SlideElement, SlideSpec } from '../types/slide-spec';
import type { ComputeResult, MetricRecord, SourceRef, ChartDataSet } from './metric-engine';

export interface ElementProvenance {
  /** Human-readable one-liner about where this element's content came from. */
  origin: string;
  /** 'computed' = derived from Excel numbers, 'narrative' = AI text, 'static' = layout only. */
  kind: 'computed' | 'narrative' | 'static';
  /** Metrics that back this element. */
  metrics: MetricRecord[];
  /** Distinct source cells behind those metrics. */
  sources: SourceRef[];
  /** Chart dataset, when the element is a chart. */
  chart?: ChartDataSet | null;
  /** Step-by-step explanation of the computation. */
  steps: string[];
}

/** Maps an AI-chosen dataKey onto an actual computed chart. */
export function resolveChart(
  dataKey: string | undefined,
  result: ComputeResult | null,
): ChartDataSet | null {
  if (!result || result.charts.length === 0) return null;
  if (!dataKey) return result.charts[0];

  const key = dataKey.toLowerCase();
  const byTitle = (pred: (t: string) => boolean) =>
    result.charts.find(c => pred(c.title));

  if (key.includes('rank')) {
    return byTitle(t => t.includes('排名')) ?? result.charts[result.charts.length - 1];
  }
  if (key.includes('mom') || key.includes('month')) {
    return byTitle(t => t.includes('月增')) ?? result.charts[Math.min(1, result.charts.length - 1)];
  }
  if (key.includes('card') || key.includes('流通')) {
    return byTitle(t => t.includes('流通') || t.includes('卡')) ?? result.charts[0];
  }
  if (key.includes('share') || key.includes('trend') || key.includes('市占')) {
    return byTitle(t => t.includes('市占')) ?? result.charts[0];
  }
  return result.charts[0];
}

/** Extracts numbers mentioned in a text string, for matching against metrics. */
function numbersIn(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map(Number).filter(n => Number.isFinite(n));
}

/** Finds metrics whose value appears in the given text. */
function metricsMentionedIn(text: string, metrics: MetricRecord[]): MetricRecord[] {
  const nums = numbersIn(text);
  if (nums.length === 0) return [];
  const hits: MetricRecord[] = [];
  for (const n of nums) {
    const m = metrics.find(x => Math.abs(x.value - n) < 0.005);
    if (m && !hits.includes(m)) hits.push(m);
    if (hits.length >= 4) break;
  }
  return hits;
}

function dedupeSources(metrics: MetricRecord[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const m of metrics) {
    for (const s of m.sourceRefs) {
      if (seen.has(s.sourceId)) continue;
      seen.add(s.sourceId);
      out.push(s);
    }
  }
  return out;
}

/**
 * Builds the full provenance record for one slide element.
 */
export function traceElement(
  el: SlideElement,
  result: ComputeResult | null,
): ElementProvenance {
  const empty: ElementProvenance = {
    origin: '版面元素，無數據來源',
    kind: 'static',
    metrics: [],
    sources: [],
    steps: [],
  };
  if (!result) return empty;

  switch (el.type) {
    case 'chart': {
      const chart = resolveChart(el.dataKey, result);
      if (!chart) return { ...empty, origin: '圖表尚未有對應數據' };
      const metrics = chart.metricIds
        .map(id => result.metrics.find(m => m.metricId === id))
        .filter((m): m is MetricRecord => Boolean(m));
      const sources = dedupeSources(metrics);
      const sheets = [...new Set(sources.map(s => s.sheetName))];
      return {
        origin: `圖表「${chart.title}」— 由 ${metrics.length} 個指標、${sources.length} 個儲存格計算`,
        kind: 'computed',
        metrics,
        sources,
        chart,
        steps: [
          `① 讀取工作表：${sheets.join('、') || '（未知）'}`,
          `② 取得 ${chart.categories.length} 個期間 × ${chart.series.length} 條數列的原始數值`,
          `③ 套用公式：${metrics[0]?.formula ?? '市占率 = 個別銀行 / 全體銀行 × 100'}`,
          `④ 範例計算：${metrics[0]?.computationStep ?? '—'}`,
          `⑤ 依 ${chart.type === 'bar' ? '數值大小排序後取前 10 名' : '期間先後排序'} 繪製${chart.type === 'bar' ? '柱狀圖' : '折線圖'}`,
        ],
      };
    }

    case 'kpi_block': {
      const metrics: MetricRecord[] = [];
      for (const kpi of el.metrics ?? []) {
        const byEntity = result.metrics.filter(m => m.entity === kpi.label);
        const target = numbersIn(kpi.value)[0];
        const exact = target != null
          ? byEntity.find(m => Math.abs(m.value - target) < 0.005)
          : undefined;
        const pick = exact ?? byEntity[byEntity.length - 1];
        if (pick) metrics.push(pick);
      }
      const sources = dedupeSources(metrics);
      return {
        origin: `${el.metrics?.length ?? 0} 項關鍵指標 — 對應 ${sources.length} 個原始儲存格`,
        kind: 'computed',
        metrics,
        sources,
        steps: metrics.length
          ? metrics.map(m => `${m.entity} ${m.metricName}：${m.computationStep}${m.rank ? `（排名 ${m.rank}/${m.rankTotal}）` : ''}`)
          : ['指標數值由 AI 依計算結果摘要，未對上單一儲存格'],
      };
    }

    case 'comparison': {
      const metrics: MetricRecord[] = [];
      for (const e of el.entities ?? []) {
        const target = numbersIn(e.value)[0];
        const byEntity = result.metrics.filter(m => m.entity === e.name);
        const exact = target != null
          ? byEntity.find(m => Math.abs(m.value - target) < 0.005)
          : undefined;
        const pick = exact ?? byEntity[byEntity.length - 1];
        if (pick) metrics.push(pick);
      }
      const sources = dedupeSources(metrics);
      const sorted = [...metrics].sort((a, b) => b.value - a.value);
      const steps: string[] = metrics.map(m => `${m.entity}：${m.computationStep}`);
      if (sorted.length >= 2) {
        const gap = Math.round((sorted[0].value - sorted[sorted.length - 1].value) * 100) / 100;
        steps.push(`比較方式：同期間、同工作表下並列，最大差距 ${gap} ${sorted[0].unit}`);
      }
      return {
        origin: `${el.entities?.length ?? 0} 家銀行同期比較`,
        kind: 'computed',
        metrics,
        sources,
        steps,
      };
    }

    case 'insight':
    case 'text_block': {
      const metrics = metricsMentionedIn(el.content ?? '', result.metrics);
      const sources = dedupeSources(metrics);
      return {
        origin: metrics.length
          ? `AI 敘述，其中 ${metrics.length} 個數字已對回計算結果`
          : 'AI 敘述，未含可驗證數字',
        kind: 'narrative',
        metrics,
        sources,
        steps: metrics.length
          ? metrics.map(m => `「${m.value}${m.unit}」← ${m.entity} ${m.metricName}：${m.computationStep}`)
          : ['此段為定性描述，不含需驗證的量化主張'],
      };
    }

    case 'bullet_list': {
      const joined = (el.items ?? []).join(' ');
      const metrics = metricsMentionedIn(joined, result.metrics);
      const sources = dedupeSources(metrics);
      return {
        origin: `${el.items?.length ?? 0} 條要點，${metrics.length} 個數字可追溯`,
        kind: 'narrative',
        metrics,
        sources,
        steps: metrics.map(m => `「${m.value}${m.unit}」← ${m.entity} ${m.metricName}：${m.computationStep}`),
      };
    }

    case 'table': {
      const joined = (el.rows ?? []).flat().join(' ');
      const metrics = metricsMentionedIn(joined, result.metrics);
      return {
        origin: `表格 ${el.rows?.length ?? 0} 列 × ${el.headers?.length ?? 0} 欄`,
        kind: 'computed',
        metrics,
        sources: dedupeSources(metrics),
        steps: metrics.map(m => `${m.entity}：${m.computationStep}`),
      };
    }

    case 'source':
      return {
        origin: '資料來源標註',
        kind: 'static',
        metrics: [],
        sources: [],
        steps: ['原始資料由使用者上傳的 Excel 檔案提供'],
      };

    default:
      return empty;
  }
}

// ─── Reverse index: source cell → where it's used in the deck ─────────

export interface CellUsage {
  /** Pages (1-based) where this cell influences content. */
  pages: number[];
  /** Metric names computed from this cell. */
  metricNames: string[];
  /** Chart titles that include this cell. */
  chartTitles: string[];
  /** Full computation steps. */
  steps: string[];
}

/**
 * For a given source cell, work out everywhere it shows up in the deck.
 */
export function traceSourceUsage(
  ref: SourceRef,
  slides: SlideSpec[],
  result: ComputeResult | null,
): CellUsage {
  if (!result) return { pages: [], metricNames: [], chartTitles: [], steps: [] };

  const metrics = result.metrics.filter(m =>
    m.sourceRefs.some(s => s.sourceId === ref.sourceId),
  );
  const metricIds = new Set(metrics.map(m => m.metricId));

  const charts = result.charts.filter(c => c.metricIds.some(id => metricIds.has(id)));
  const chartTitles = charts.map(c => c.title);

  const pages = new Set<number>();
  for (const slide of slides) {
    for (const el of slide.elements) {
      const prov = traceElement(el, result);
      if (prov.sources.some(s => s.sourceId === ref.sourceId)) {
        pages.add(slide.page);
      }
    }
  }

  return {
    pages: [...pages].sort((a, b) => a - b),
    metricNames: [...new Set(metrics.map(m => `${m.entity} ${m.metricName}`))],
    chartTitles,
    steps: metrics.slice(0, 6).map(m => `${m.metricName}：${m.computationStep}`),
  };
}

/** Groups source refs into a table-friendly shape: entity rows × period columns. */
export interface DataTableView {
  fileName: string;
  sheetName: string;
  periods: string[];
  rows: { entity: string; cells: (SourceRef | null)[] }[];
}

export function buildDataTables(result: ComputeResult | null): DataTableView[] {
  if (!result || result.sourceRefs.length === 0) return [];

  const groups = new Map<string, SourceRef[]>();
  for (const ref of result.sourceRefs) {
    const key = `${ref.fileName}||${ref.sheetName}`;
    const list = groups.get(key);
    if (list) list.push(ref);
    else groups.set(key, [ref]);
  }

  const views: DataTableView[] = [];
  for (const [key, refs] of groups) {
    const [fileName, sheetName] = key.split('||');
    const periods = [...new Set(refs.map(r => r.period))].sort();
    const entities = [...new Set(refs.map(r => r.entity))];

    views.push({
      fileName,
      sheetName,
      periods,
      rows: entities.map(entity => ({
        entity,
        cells: periods.map(p =>
          refs.find(r => r.entity === entity && r.period === p) ?? null,
        ),
      })),
    });
  }

  return views;
}
