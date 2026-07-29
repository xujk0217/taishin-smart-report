/**
 * Browser-side metric computation engine.
 * Calculates market share, ranking, MoM from parsed Excel data.
 * Every computed value retains source traceability.
 */
import type { FileSummary, SheetSummary } from './excel-reader';

export interface SourceRef {
  sourceId: string;
  fileName: string;
  sheetName: string;
  cellAddress: string;
  rawValue: string;
  value: number;
  period: string;
  entity: string;
}

export interface MetricRecord {
  metricId: string;
  metricName: string;
  formula: string;
  value: number;
  unit: string;
  period: string;
  entity: string;
  rank?: number;
  rankTotal?: number;
  sourceRefs: SourceRef[];
  computationStep: string;
}

export interface ChartDataSet {
  chartId: string;
  title: string;
  type: 'line' | 'bar';
  categories: string[]; // x-axis labels (periods or entities)
  series: { name: string; data: number[]; color?: string }[];
  metricIds: string[];
}

export interface ComputeResult {
  metrics: MetricRecord[];
  charts: ChartDataSet[];
  sourceRefs: SourceRef[];
  summary: {
    totalMetrics: number;
    totalEntities: number;
    totalPeriods: number;
    sheetsUsed: number;
  };
}

/**
 * Compute all metrics from parsed Excel files.
 */
export function computeMetrics(fileSummaries: FileSummary[]): ComputeResult {
  const allRefs: SourceRef[] = [];
  const allMetrics: MetricRecord[] = [];
  let refCounter = 0;
  let metricCounter = 0;

  // Extract all data points as SourceRefs
  for (const file of fileSummaries) {
    for (const sheet of file.sheets) {
      const periodCols = detectPeriodColumns(sheet.columns);
      if (periodCols.length === 0) continue;

      // Each row = one entity, each period column = one data point
      for (const row of sheet.sampleRows) {
        // Actually use ALL rows from the full data
        // For now, sampleRows is limited, but structure is correct
      }

      // Build refs from ALL available data
      const entityCol = 0;
      const rows = sheet.allRows || sheet.sampleRows;
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        if (!row || row.length === 0) continue;

        const entity = normalizeEntity(row[entityCol] || '');
        if (!entity) continue;

        for (const { colIdx, period } of periodCols) {
          if (colIdx >= row.length) continue;
          const rawValue = row[colIdx];
          const numValue = parseNumber(rawValue);
          if (numValue === null) continue;

          refCounter++;
          allRefs.push({
            sourceId: `src-${String(refCounter).padStart(4, '0')}`,
            fileName: file.fileName,
            sheetName: sheet.sheetName,
            cellAddress: `${colLetter(colIdx + 1)}${rowIdx + 2}`,
            rawValue: rawValue,
            value: numValue,
            period,
            entity,
          });
        }
      }
    }
  }

  if (allRefs.length === 0) {
    return { metrics: [], charts: [], sourceRefs: [], summary: { totalMetrics: 0, totalEntities: 0, totalPeriods: 0, sheetsUsed: 0 } };
  }

  // Group by sheet/period for market share calculation
  const periods = [...new Set(allRefs.map(r => r.period))].sort();
  const entities = [...new Set(allRefs.map(r => r.entity))].filter(e => e !== '全體銀行' && e !== '合計' && e !== '總計');
  const sheets = [...new Set(allRefs.map(r => r.sheetName))];

  // Calculate market share for each entity/period
  for (const sheetName of sheets) {
    const sheetRefs = allRefs.filter(r => r.sheetName === sheetName);

    for (const period of periods) {
      const periodRefs = sheetRefs.filter(r => r.period === period);
      const totalRef = periodRefs.find(r => r.entity === '全體銀行' || r.entity === '總計');
      const totalValue = totalRef?.value || 0;

      if (totalValue === 0) continue;

      const periodMetrics: MetricRecord[] = [];

      for (const entity of entities) {
        const entityRef = periodRefs.find(r => r.entity === entity);
        if (!entityRef) continue;

        const share = Math.round((entityRef.value / totalValue) * 10000) / 100; // 2 decimal %
        metricCounter++;

        periodMetrics.push({
          metricId: `metric-${String(metricCounter).padStart(4, '0')}`,
          metricName: `${sheetName}市占率`,
          formula: `${entity}金額 / 全體金額 × 100`,
          value: share,
          unit: '%',
          period,
          entity,
          sourceRefs: [entityRef, ...(totalRef ? [totalRef] : [])],
          computationStep: `${entityRef.value} / ${totalValue} × 100 = ${share}%`,
        });
      }

      // Compute rankings
      periodMetrics.sort((a, b) => b.value - a.value);
      periodMetrics.forEach((m, i) => {
        m.rank = i + 1;
        m.rankTotal = periodMetrics.length;
      });

      allMetrics.push(...periodMetrics);
    }
  }

  // Compute MoM for top entities
  const topEntities = getTopEntities(allMetrics, 5);
  for (const entity of topEntities) {
    const entityMetrics = allMetrics.filter(m => m.entity === entity).sort((a, b) => a.period.localeCompare(b.period));
    for (let i = 1; i < entityMetrics.length; i++) {
      const prev = entityMetrics[i - 1];
      const curr = entityMetrics[i];
      if (prev.value === 0) continue;
      const mom = Math.round(((curr.value - prev.value) / prev.value) * 10000) / 100;
      metricCounter++;
      allMetrics.push({
        metricId: `metric-${String(metricCounter).padStart(4, '0')}`,
        metricName: `${curr.metricName.replace('市占率', '')}月增率`,
        formula: `(本月 - 上月) / 上月 × 100`,
        value: mom,
        unit: '%',
        period: curr.period,
        entity,
        sourceRefs: [...curr.sourceRefs, ...prev.sourceRefs],
        computationStep: `(${curr.value} - ${prev.value}) / ${prev.value} × 100 = ${mom}%`,
      });
    }
  }

  // Build chart datasets
  const charts = buildCharts(allMetrics, periods, topEntities, sheets);

  return {
    metrics: allMetrics,
    charts,
    sourceRefs: allRefs,
    summary: {
      totalMetrics: allMetrics.length,
      totalEntities: entities.length,
      totalPeriods: periods.length,
      sheetsUsed: sheets.length,
    },
  };
}

function buildCharts(metrics: MetricRecord[], periods: string[], topEntities: string[], sheets: string[]): ChartDataSet[] {
  const charts: ChartDataSet[] = [];
  const colors = ['#C01B2B', '#2E5090', '#4CAF50', '#FF9800', '#9C27B0'];
  let chartCounter = 0;

  // Market share trend (line chart per sheet)
  for (const sheet of sheets) {
    const sheetMetrics = metrics.filter(m => m.metricName.includes('市占率') && m.metricName.includes(sheet));
    if (sheetMetrics.length === 0) continue;

    chartCounter++;
    // Clean up sheet name for title
    const cleanName = sheet.replace(/P\.\d+預期修正_/, '');
    const series = topEntities.map((entity, i) => ({
      name: entity,
      data: periods.map(p => {
        const m = sheetMetrics.find(x => x.entity === entity && x.period === p);
        return m?.value ?? 0;
      }),
      color: colors[i % colors.length],
    }));

    charts.push({
      chartId: `chart-${chartCounter}`,
      title: `${cleanName}市占率趨勢`,
      type: 'line',
      categories: periods,
      series,
      metricIds: sheetMetrics.filter(m => topEntities.includes(m.entity)).map(m => m.metricId),
    });
  }

  // Ranking bar chart (latest period)
  if (periods.length > 0) {
    const latestPeriod = periods[periods.length - 1];
    const latestMetrics = metrics
      .filter(m => m.period === latestPeriod && m.metricName.includes('市占率') && m.rank)
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .slice(0, 10);

    if (latestMetrics.length > 0) {
      chartCounter++;
      charts.push({
        chartId: `chart-${chartCounter}`,
        title: `${latestPeriod} 銀行排名 Top 10`,
        type: 'bar',
        categories: latestMetrics.map(m => m.entity),
        series: [{
          name: '市占率 (%)',
          data: latestMetrics.map(m => m.value),
          color: '#C01B2B',
        }],
        metricIds: latestMetrics.map(m => m.metricId),
      });
    }
  }

  return charts;
}

// ─── Helpers ──────────────────────────────────────────────────

function detectPeriodColumns(columns: string[]): { colIdx: number; period: string }[] {
  const results: { colIdx: number; period: string }[] = [];
  for (let i = 0; i < columns.length; i++) {
    const period = normalizePeriod(columns[i]);
    if (period) results.push({ colIdx: i, period });
  }
  return results;
}

function normalizePeriod(raw: string): string | null {
  const s = String(raw).trim();
  // 5-digit: 11401
  if (/^\d{5}$/.test(s)) {
    const year = parseInt(s.slice(0, 3));
    const month = parseInt(s.slice(3));
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) return s;
  }
  // 114/01 or 114-01
  const m1 = s.match(/^(\d{3})[/\-.](\d{1,2})$/);
  if (m1) {
    const [, y, mo] = m1;
    return `${y}${mo.padStart(2, '0')}`;
  }
  // 2025/01
  const m2 = s.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (m2) {
    const rocYear = parseInt(m2[1]) - 1911;
    if (rocYear >= 100 && rocYear <= 200) return `${rocYear}${m2[2].padStart(2, '0')}`;
  }
  return null;
}

function normalizeEntity(raw: string): string {
  const map: Record<string, string> = {
    '台新': '台新銀行', '台新國際商業銀行': '台新銀行', '台新銀行': '台新銀行',
    '中信': '中國信託', '中國信託商業銀行': '中國信託', '中國信託': '中國信託',
    '國泰': '國泰世華', '國泰世華商業銀行': '國泰世華', '國泰世華': '國泰世華',
    '玉山': '玉山銀行', '玉山商業銀行': '玉山銀行', '玉山銀行': '玉山銀行',
    '富邦': '台北富邦', '台北富邦商業銀行': '台北富邦', '台北富邦': '台北富邦',
    '永豐': '永豐銀行', '永豐商業銀行': '永豐銀行', '永豐銀行': '永豐銀行',
    '聯邦': '聯邦銀行', '聯邦商業銀行': '聯邦銀行', '聯邦銀行': '聯邦銀行',
    '第一': '第一銀行', '第一商業銀行': '第一銀行', '第一銀行': '第一銀行',
    '星展': '星展銀行', '星展(台灣)商業銀行': '星展銀行', '星展銀行': '星展銀行',
    '滙豐': '滙豐銀行', '滙豐(台灣)商業銀行': '滙豐銀行', '滙豐銀行': '滙豐銀行',
    '合計': '全體銀行', '總計': '全體銀行', '全體': '全體銀行',
  };
  const s = raw.trim();
  return map[s] || s;
}

function parseNumber(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim().replace(/,/g, '').replace(/％|%/, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function colLetter(col: number): string {
  let s = '';
  while (col > 0) {
    col--;
    s = String.fromCharCode(65 + (col % 26)) + s;
    col = Math.floor(col / 26);
  }
  return s;
}

function getTopEntities(metrics: MetricRecord[], count: number): string[] {
  const entityAvg: Record<string, { sum: number; count: number }> = {};
  for (const m of metrics) {
    if (!m.metricName.includes('市占率')) continue;
    if (!entityAvg[m.entity]) entityAvg[m.entity] = { sum: 0, count: 0 };
    entityAvg[m.entity].sum += m.value;
    entityAvg[m.entity].count++;
  }
  return Object.entries(entityAvg)
    .map(([entity, { sum, count }]) => ({ entity, avg: sum / count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, count)
    .map(e => e.entity);
}
