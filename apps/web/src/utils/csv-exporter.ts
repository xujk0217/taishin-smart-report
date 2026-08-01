/**
 * CSV export — exports all computed metrics and source data as downloadable CSV files.
 */
import { saveAs } from 'file-saver';
import type { ComputeResult } from './metric-engine';

/**
 * Exports a ZIP-like bundle of CSV files (actually individual downloads).
 * For simplicity, we create one combined CSV with all data.
 */
export function exportCSV(
  result: ComputeResult | null,
  fileName = '數據分析報告.csv',
): void {
  if (!result) {
    alert('沒有可匯出的計算結果');
    return;
  }

  const lines: string[] = [];

  // Section 1: Metrics
  lines.push('=== 計算指標 ===');
  lines.push('指標ID,指標名稱,實體,期間,數值,單位,排名,公式,計算過程');
  for (const m of result.metrics) {
    lines.push([
      m.metricId,
      m.metricName,
      m.entity,
      m.period,
      m.value,
      m.unit,
      m.rank ?? '',
      `"${m.formula.replace(/"/g, '""')}"`,
      `"${m.computationStep.replace(/"/g, '""')}"`,
    ].join(','));
  }

  lines.push('');
  lines.push('=== 原始資料來源 ===');
  lines.push('來源ID,檔案,工作表,儲存格,實體,期間,原始值,解析數值');
  for (const s of result.sourceRefs) {
    lines.push([
      s.sourceId,
      `"${s.fileName.replace(/"/g, '""')}"`,
      `"${s.sheetName.replace(/"/g, '""')}"`,
      s.cellAddress,
      `"${s.entity.replace(/"/g, '""')}"`,
      s.period,
      `"${s.rawValue.replace(/"/g, '""')}"`,
      s.value,
    ].join(','));
  }

  lines.push('');
  lines.push('=== 圖表資料 ===');
  for (const c of result.charts) {
    lines.push(`圖表: ${c.title} (${c.type})`);
    lines.push(['期間', ...c.series.map(s => s.name)].join(','));
    for (let i = 0; i < c.categories.length; i++) {
      lines.push([c.categories[i], ...c.series.map(s => s.data[i])].join(','));
    }
    lines.push('');
  }

  lines.push('');
  lines.push('=== 摘要 ===');
  lines.push(`工作表數,${result.summary.sheetsUsed}`);
  lines.push(`實體數,${result.summary.totalEntities}`);
  lines.push(`期間數,${result.summary.totalPeriods}`);
  lines.push(`指標數,${result.summary.totalMetrics}`);
  lines.push(`圖表數,${result.charts.length}`);
  lines.push(`原始儲存格數,${result.sourceRefs.length}`);

  // BOM for Excel to recognise UTF-8
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, fileName);
}
