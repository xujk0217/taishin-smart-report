/**
 * Multi-file merger: combines 12 monthly Excel files into unified structure.
 * Extracts period from filename, pivots data so columns = months.
 * Output format matches 附件四 (rows=banks, cols=11401-11412).
 */
import type { FileSummary, SheetSummary } from './excel-reader';

/**
 * Detect if uploaded files are monthly single-month files
 * (vs. already-merged multi-period files like 附件四).
 */
export function isMonthlyFileSet(summaries: FileSummary[]): boolean {
  if (summaries.length < 2) return false;
  
  // Check if filenames contain period patterns (11401, 11402, etc.)
  const periodFiles = summaries.filter(f => extractPeriodFromFilename(f.fileName) !== null);
  return periodFiles.length >= 2;
}

/**
 * Extract period (YYMM) from filename.
 * Handles: "11401信用卡...", "11401_信用卡...", "附表5_114年2月..."
 */
export function extractPeriodFromFilename(fileName: string): string | null {
  // Pattern: starts with 5 digits (11401)
  const m1 = fileName.match(/^(\d{5})/);
  if (m1) {
    const year = parseInt(m1[1].slice(0, 3));
    const month = parseInt(m1[1].slice(3));
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) {
      return m1[1];
    }
  }

  // Pattern: 114年2月 or 114年02月
  const m2 = fileName.match(/(\d{3})年(\d{1,2})月/);
  if (m2) {
    const year = parseInt(m2[1]);
    const month = parseInt(m2[2]);
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) {
      return `${year}${String(month).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Merge multiple monthly files into unified multi-period structure.
 * Transforms: {file per month, cols = metrics} → {cols = months per metric}
 */
export function mergeMonthlyFiles(summaries: FileSummary[]): FileSummary[] {
  // Group files by period
  const filesByPeriod: Map<string, FileSummary> = new Map();
  const nonPeriodFiles: FileSummary[] = [];

  for (const file of summaries) {
    const period = extractPeriodFromFilename(file.fileName);
    if (period) {
      filesByPeriod.set(period, file);
    } else {
      nonPeriodFiles.push(file);
    }
  }

  if (filesByPeriod.size < 2) {
    // Not enough monthly files to merge, return as-is
    return summaries;
  }

  const periods = [...filesByPeriod.keys()].sort();
  console.log(`[Merger] Merging ${periods.length} monthly files: ${periods.join(', ')}`);

  // Detect columns (metrics) from first file
  const firstFile = filesByPeriod.get(periods[0])!;
  const firstSheet = firstFile.sheets[0];
  if (!firstSheet) return summaries;

  // Find header row (row with "金融機構名稱" or entity column)
  let headerRowIdx = -1;
  let metricColumns: { colIdx: number; name: string }[] = [];

  for (let i = 0; i < Math.min(firstSheet.allRows.length, 10); i++) {
    const row = firstSheet.allRows[i];
    if (row.some(c => c.includes('金融機構') || c.includes('銀行'))) {
      headerRowIdx = i;
      // Columns after the first one are metrics
      for (let j = 1; j < row.length; j++) {
        const name = row[j]?.trim();
        if (name && !name.includes('備註') && name.length > 1) {
          metricColumns.push({ colIdx: j, name: name.replace(/\s+/g, '') });
        }
      }
      break;
    }
  }

  if (headerRowIdx === -1 || metricColumns.length === 0) {
    console.warn('[Merger] Cannot detect header row');
    return summaries;
  }

  // Key metrics we want to merge (match 附件四 structure)
  const targetMetrics = [
    { keyword: '流通卡數', name: '流通卡數' },
    { keyword: '當月簽帳金額', name: '當月簽帳金額' },
    { keyword: '有效卡數', name: '有效卡數' },
    { keyword: '循環信用餘額', name: '循環信用餘額' },
  ];

  // Build merged sheets (one per metric)
  const mergedSheets: SheetSummary[] = [];

  for (const target of targetMetrics) {
    const metricCol = metricColumns.find(c => c.name.includes(target.keyword));
    if (!metricCol) continue;

    // Collect all entities and their values across months
    const entityData: Map<string, Map<string, string>> = new Map(); // entity → {period → value}

    for (const period of periods) {
      const file = filesByPeriod.get(period)!;
      const sheet = file.sheets[0];
      if (!sheet) continue;

      // Find this file's header row
      let fileHeaderIdx = -1;
      let fileMetricColIdx = -1;
      for (let i = 0; i < Math.min(sheet.allRows.length, 10); i++) {
        const row = sheet.allRows[i];
        if (row.some(c => c.includes('金融機構') || c.includes('銀行'))) {
          fileHeaderIdx = i;
          for (let j = 1; j < row.length; j++) {
            if (row[j]?.replace(/\s+/g, '').includes(target.keyword)) {
              fileMetricColIdx = j;
              break;
            }
          }
          break;
        }
      }

      if (fileHeaderIdx === -1 || fileMetricColIdx === -1) continue;

      // Read entity values
      for (let i = fileHeaderIdx + 1; i < sheet.allRows.length; i++) {
        const row = sheet.allRows[i];
        const entity = row[0]?.trim();
        if (!entity || entity.includes('資料來源') || entity.includes('揭露項目')) break;
        if (!entity || entity.length < 2) continue;

        const value = row[fileMetricColIdx] || '';
        if (!entityData.has(entity)) entityData.set(entity, new Map());
        entityData.get(entity)!.set(period, value);
      }
    }

    if (entityData.size === 0) continue;

    // Build merged sheet: columns = ['金融機構名稱', '11401', '11402', ...]
    const columns = ['金融機構名稱', ...periods];
    const allRows: string[][] = [];
    const sampleRows: string[][] = [];

    for (const [entity, periodValues] of entityData) {
      const row = [entity, ...periods.map(p => periodValues.get(p) || '')];
      allRows.push(row);
    }

    mergedSheets.push({
      sheetName: target.name,
      columns,
      rowCount: allRows.length,
      sampleRows: allRows.slice(0, 3),
      allRows,
    });
  }

  if (mergedSheets.length === 0) {
    return summaries;
  }

  // Return merged as a single FileSummary (+ any non-period files)
  const merged: FileSummary = {
    fileName: `合併資料 (${periods.length}個月)`,
    fileSize: summaries.reduce((sum, f) => sum + f.fileSize, 0),
    sheets: mergedSheets,
  };

  console.log(`[Merger] Created ${mergedSheets.length} merged sheets with ${periods.length} periods`);
  return [merged, ...nonPeriodFiles];
}
