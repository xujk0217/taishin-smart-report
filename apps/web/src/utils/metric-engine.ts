/**
 * Browser-side metric computation engine.
 * Generalized data analysis: detects structure, computes share/ranking/growth
 * from ANY tabular data. Every computed value retains source traceability.
 *
 * Core capabilities:
 * - Auto-detect entity columns (first text column) and value columns (numeric)
 * - Auto-detect period columns (dates, months, quarters)
 * - Compute share (entity / total), ranking, MoM/period-over-period growth
 * - Build chart datasets for visualization
 * - Full provenance: every metric traces back to source cells
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
  type: 'line' | 'bar' | 'pie';
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

// ─── Total row detection keywords ────────────────────────────

const TOTAL_KEYWORDS = [
  '合計', '總計', '全體', 'total', 'sum', '小計', 'subtotal',
  '全部', '整體', '總和', 'grand total',
];

function isTotalEntity(entity: string): boolean {
  const lower = entity.toLowerCase().trim();
  return TOTAL_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

// ─── Main computation ────────────────────────────────────────

/**
 * Compute all metrics from parsed files.
 * Generalized: works with any tabular data that has entities (rows) and
 * numeric values organized by periods or categories.
 */
export function computeMetrics(fileSummaries: FileSummary[]): ComputeResult {
  const allRefs: SourceRef[] = [];
  const allMetrics: MetricRecord[] = [];
  let refCounter = 0;
  let metricCounter = 0;

  // Extract all data points as SourceRefs
  for (const file of fileSummaries) {
    for (const sheet of file.sheets) {
      // Try period-based columns first (time-series data)
      const periodCols = detectPeriodColumns(sheet.columns);

      if (periodCols.length > 0) {
        // Time-series layout: rows = entities, columns = periods
        const entityCol = detectEntityColumn(sheet.columns, periodCols.map(p => p.colIdx));
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
              rawValue,
              value: numValue,
              period,
              entity,
            });
          }
        } 
      } else {
        // Non-time-series: try to detect numeric columns as metrics
        const numCols = detectNumericColumns(sheet.columns, sheet.allRows || sheet.sampleRows);
        if (numCols.length === 0) continue;

        const entityCol = detectEntityColumn(sheet.columns, numCols.map(c => c.colIdx));
        const rows = sheet.allRows || sheet.sampleRows;

        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const row = rows[rowIdx];
          if (!row || row.length === 0) continue;

          const entity = normalizeEntity(row[entityCol] || '');
          if (!entity) continue;

          for (const { colIdx, name } of numCols) {
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
              rawValue,
              value: numValue,
              period: name, // Use column name as "period" dimension
              entity,
            });
          }
        }
      }
    }
  }

  if (allRefs.length === 0) {
    return { metrics: [], charts: [], sourceRefs: [], summary: { totalMetrics: 0, totalEntities: 0, totalPeriods: 0, sheetsUsed: 0 } };
  }

  // Group data
  const periods = [...new Set(allRefs.map(r => r.period))].sort();
  const entities = [...new Set(allRefs.map(r => r.entity))].filter(e => !isTotalEntity(e));
  const sheets = [...new Set(allRefs.map(r => r.sheetName))];

  // Calculate share (percentage of total) for each entity/period
  for (const sheetName of sheets) {
    const sheetRefs = allRefs.filter(r => r.sheetName === sheetName);

    for (const period of periods) {
      const periodRefs = sheetRefs.filter(r => r.period === period);
      const totalRef = periodRefs.find(r => isTotalEntity(r.entity));
      const totalValue = totalRef?.value || 0;

      if (totalValue === 0) continue;

      const periodMetrics: MetricRecord[] = [];

      for (const entity of entities) {
        const entityRef = periodRefs.find(r => r.entity === entity);
        if (!entityRef) continue;

        const share = Math.round((entityRef.value / totalValue) * 10000) / 100;
        metricCounter++;

        periodMetrics.push({
          metricId: `metric-${String(metricCounter).padStart(4, '0')}`,
          metricName: `${sheetName}佔比`,
          formula: `${entity} / 合計 × 100`,
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

  // If no total row was found, compute raw value metrics and rank by them
  if (allMetrics.length === 0) {
    for (const sheetName of sheets) {
      const sheetRefs = allRefs.filter(r => r.sheetName === sheetName);

      for (const period of periods) {
        const periodRefs = sheetRefs.filter(r => r.period === period && !isTotalEntity(r.entity));
        if (periodRefs.length === 0) continue;

        const periodMetrics: MetricRecord[] = [];
        for (const ref of periodRefs) {
          metricCounter++;
          periodMetrics.push({
            metricId: `metric-${String(metricCounter).padStart(4, '0')}`,
            metricName: `${sheetName}數值`,
            formula: '原始數值',
            value: ref.value,
            unit: '',
            period,
            entity: ref.entity,
            sourceRefs: [ref],
            computationStep: `原始值 = ${ref.value}`,
          });
        }

        // Rank by value
        periodMetrics.sort((a, b) => b.value - a.value);
        periodMetrics.forEach((m, i) => {
          m.rank = i + 1;
          m.rankTotal = periodMetrics.length;
        });

        allMetrics.push(...periodMetrics);
      }
    }
  }

  // Compute period-over-period growth for top entities
  const topEntities = getTopEntities(allMetrics, 5);
  for (const entity of topEntities) {
    const entityMetrics = allMetrics
      .filter(m => m.entity === entity && !m.metricName.includes('成長率'))
      .sort((a, b) => a.period.localeCompare(b.period));

    for (let i = 1; i < entityMetrics.length; i++) {
      const prev = entityMetrics[i - 1];
      const curr = entityMetrics[i];
      if (prev.value === 0) continue;
      const growth = Math.round(((curr.value - prev.value) / prev.value) * 10000) / 100;
      metricCounter++;
      allMetrics.push({
        metricId: `metric-${String(metricCounter).padStart(4, '0')}`,
        metricName: `${curr.metricName.replace('佔比', '').replace('數值', '')}成長率`,
        formula: `(本期 - 上期) / 上期 × 100`,
        value: growth,
        unit: '%',
        period: curr.period,
        entity,
        sourceRefs: [...curr.sourceRefs, ...prev.sourceRefs],
        computationStep: `(${curr.value} - ${prev.value}) / ${prev.value} × 100 = ${growth}%`,
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
  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
  let chartCounter = 0;

  // Trend chart (line chart per sheet) — for share or value metrics
  for (const sheet of sheets) {
    const sheetMetrics = metrics.filter(m =>
      (m.metricName.includes('佔比') || m.metricName.includes('數值')) &&
      !m.metricName.includes('成長率') &&
      m.metricName.includes(sheet)
    );
    if (sheetMetrics.length === 0) continue;

    chartCounter++;
    const cleanName = sheet.replace(/P\.\d+.*?_/, '');
    const hasShare = sheetMetrics.some(m => m.metricName.includes('佔比'));
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
      title: `${cleanName}${hasShare ? '佔比' : '數值'}趨勢`,
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
      .filter(m => m.period === latestPeriod && !m.metricName.includes('成長率') && m.rank)
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .slice(0, 10);

    if (latestMetrics.length > 0) {
      chartCounter++;
      const hasShare = latestMetrics.some(m => m.metricName.includes('佔比'));
      charts.push({
        chartId: `chart-${chartCounter}`,
        title: `${latestPeriod} 排名 Top ${Math.min(10, latestMetrics.length)}`,
        type: 'bar',
        categories: latestMetrics.map(m => m.entity),
        series: [{
          name: hasShare ? '佔比 (%)' : '數值',
          data: latestMetrics.map(m => m.value),
          color: colors[0],
        }],
        metricIds: latestMetrics.map(m => m.metricId),
      });
    }
  }

  // Pie chart for latest period composition
  if (periods.length > 0 && topEntities.length > 0) {
    const latestPeriod = periods[periods.length - 1];
    const pieMetrics = metrics
      .filter(m => m.period === latestPeriod && m.metricName.includes('佔比') && m.rank && m.rank <= 8)
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));

    if (pieMetrics.length >= 3) {
      chartCounter++;
      charts.push({
        chartId: `chart-${chartCounter}`,
        title: `${latestPeriod} 組成分布`,
        type: 'pie',
        categories: pieMetrics.map(m => m.entity),
        series: [{
          name: '佔比',
          data: pieMetrics.map(m => m.value),
        }],
        metricIds: pieMetrics.map(m => m.metricId),
      });
    }
  }

  return charts;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Detect which columns contain period/time information.
 * Supports: YYMM (11401), YYYY/MM, YYYY-MM, Q1/Q2, 民國年月, etc.
 */
function detectPeriodColumns(columns: string[]): { colIdx: number; period: string }[] {
  const results: { colIdx: number; period: string }[] = [];
  for (let i = 0; i < columns.length; i++) {
    const period = normalizePeriod(columns[i]);
    if (period) results.push({ colIdx: i, period });
  }
  return results;
}

/**
 * Normalize various date/period formats to a sortable string.
 * Supports: 11401, 114/01, 2025/01, 2025-01, Jan-2025, Q1 2025,
 *           1月, 2月, 114年1月, etc.
 */
function normalizePeriod(raw: string): string | null {
  const s = String(raw).trim();

  // 5-digit ROC format: 11401 (year 114, month 01)
  if (/^\d{5}$/.test(s)) {
    const year = parseInt(s.slice(0, 3));
    const month = parseInt(s.slice(3));
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) return s;
  }

  // ROC 114/01 or 114-01
  const m1 = s.match(/^(\d{3})[/\-.](\d{1,2})$/);
  if (m1) {
    const [, y, mo] = m1;
    return `${y}${mo.padStart(2, '0')}`;
  }

  // Western date YYYY/MM or YYYY-MM
  const m2 = s.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY-MM-DD → extract year-month
  const m3 = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m3) {
    return `${m3[1]}-${m3[2].padStart(2, '0')}`;
  }

  // Quarter format: Q1 2025, 2025 Q1, 1Q25, etc.
  const mQ = s.match(/[Qq](\d)\s*(\d{4})|(\d{4})\s*[Qq](\d)/);
  if (mQ) {
    const quarter = mQ[1] || mQ[4];
    const year = mQ[2] || mQ[3];
    return `${year}-Q${quarter}`;
  }

  // 民國年月: 114年1月, 114年01月
  const mRoc = s.match(/(\d{2,3})年(\d{1,2})月/);
  if (mRoc) {
    const year = parseInt(mRoc[1]);
    const month = parseInt(mRoc[2]);
    if (year >= 1 && year <= 200 && month >= 1 && month <= 12) {
      return `${String(year).padStart(3, '0')}${String(month).padStart(2, '0')}`;
    }
  }

  // Simple month names: 1月, 2月, Jan, Feb, etc.
  const mMonth = s.match(/^(\d{1,2})月$/);
  if (mMonth) {
    const month = parseInt(mMonth[1]);
    if (month >= 1 && month <= 12) return `M${String(month).padStart(2, '0')}`;
  }

  // English month abbreviations
  const engMonths: Record<string, string> = {
    jan: 'M01', feb: 'M02', mar: 'M03', apr: 'M04',
    may: 'M05', jun: 'M06', jul: 'M07', aug: 'M08',
    sep: 'M09', oct: 'M10', nov: 'M11', dec: 'M12',
  };
  const lower = s.toLowerCase().replace(/[.\-_]/, '');
  if (engMonths[lower.slice(0, 3)] && lower.length <= 4) {
    return engMonths[lower.slice(0, 3)];
  }

  return null;
}

/**
 * Detect which column is the entity/category column.
 * Typically the first text column that isn't a period or number.
 */
function detectEntityColumn(columns: string[], excludeCols: number[]): number {
  const excludeSet = new Set(excludeCols);
  for (let i = 0; i < columns.length; i++) {
    if (excludeSet.has(i)) continue;
    const col = columns[i].trim();
    // Skip if it looks like a number or period
    if (!col || normalizePeriod(col) !== null || /^\d+$/.test(col)) continue;
    return i;
  }
  return 0; // fallback to first column
}

/**
 * Detect numeric columns when no period columns are found.
 * Returns columns where >50% of values are parseable as numbers.
 */
function detectNumericColumns(columns: string[], rows: string[][]): { colIdx: number; name: string }[] {
  const results: { colIdx: number; name: string }[] = [];
  const sampleRows = rows.slice(0, Math.min(rows.length, 20));

  for (let i = 1; i < columns.length; i++) { // skip first (assumed entity)
    if (!columns[i] || columns[i].trim().length === 0) continue;

    let numCount = 0;
    let total = 0;
    for (const row of sampleRows) {
      if (i >= row.length) continue;
      total++;
      if (parseNumber(row[i]) !== null) numCount++;
    }
    if (total > 0 && numCount / total >= 0.5) {
      results.push({ colIdx: i, name: columns[i].trim() });
    }
  }
  return results;
}

/**
 * Normalize entity names: trim whitespace and standardize common variations.
 * This is a generic approach — just clean up the text.
 */
function normalizeEntity(raw: string): string {
  const s = raw.trim();
  if (!s || s === '-' || s === 'N/A' || s === 'n/a') return '';
  return s;
}

function parseNumber(raw: string): number | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
  const s = raw.trim()
    .replace(/,/g, '')
    .replace(/％|%/, '')
    .replace(/\s/g, '')
    .replace(/^[\(（](.+)[\)）]$/, '-$1'); // Handle (123) as negative
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
    if (m.metricName.includes('成長率')) continue;
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
