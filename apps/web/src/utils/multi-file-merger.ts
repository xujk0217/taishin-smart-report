/**
 * Multi-file merger: detects when uploaded files represent related time-period
 * data and merges them into a unified multi-period structure.
 *
 * Supports:
 * - Files named with period patterns (11401, 2024-01, Q1_2025, etc.)
 * - ROC year/month format (11401 = 114年1月)
 * - Western date formats (2024-01, 2024_Jan, etc.)
 * - Quarter formats (Q1_2025, 2025Q1)
 *
 * Output: merged FileSummary[] where columns = periods.
 */
import type { FileSummary, SheetSummary } from './excel-reader';

/**
 * Detect if uploaded files are periodic single-period files
 * (vs. already-merged multi-period files).
 */
export function isMonthlyFileSet(summaries: FileSummary[]): boolean {
  if (summaries.length < 2) return false;

  // Check if filenames contain period patterns
  const periodFiles = summaries.filter(f => extractPeriodFromFilename(f.fileName) !== null);
  return periodFiles.length >= 2;
}

/**
 * Extract period identifier from filename.
 * Handles multiple formats:
 * - "11401_report..." or "11401_..." → ROC YYMM
 * - "114年2月..." → ROC Year+Month
 * - "2024-01_report.xlsx" → Western YYYY-MM
 * - "2024_Q1.xlsx" → Quarter
 * - "Jan_2024.xlsx" or "January_2024.xlsx" → Month name
 * - "report_202401.xlsx" → YYYYMM
 */
export function extractPeriodFromFilename(fileName: string): string | null {
  // Pattern: starts with 5 digits (ROC YYMM: 11401)
  const m1 = fileName.match(/^(\d{5})/);
  if (m1) {
    const year = parseInt(m1[1].slice(0, 3));
    const month = parseInt(m1[1].slice(3));
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) {
      return m1[1];
    }
  }

  // Pattern: 114年2月 or 114年02月 (ROC)
  const m2 = fileName.match(/(\d{3})年(\d{1,2})月/);
  if (m2) {
    const year = parseInt(m2[1]);
    const month = parseInt(m2[2]);
    if (year >= 100 && year <= 200 && month >= 1 && month <= 12) {
      return `${year}${String(month).padStart(2, '0')}`;
    }
  }

  // Pattern: YYYYMM (202401) embedded in filename
  const m3 = fileName.match(/(\d{4})(0[1-9]|1[0-2])/);
  if (m3) {
    const year = parseInt(m3[1]);
    if (year >= 1990 && year <= 2100) {
      return `${m3[1]}-${m3[2]}`;
    }
  }

  // Pattern: YYYY-MM or YYYY_MM or YYYY/MM
  const m4 = fileName.match(/(\d{4})[_\-/](0[1-9]|1[0-2])/);
  if (m4) {
    return `${m4[1]}-${m4[2]}`;
  }

  // Pattern: Quarter — Q1_2025, 2025_Q1, 2025Q1
  const mQ1 = fileName.match(/[Qq]([1-4])[_\-\s]*(\d{4})/);
  if (mQ1) return `${mQ1[2]}-Q${mQ1[1]}`;
  const mQ2 = fileName.match(/(\d{4})[_\-\s]*[Qq]([1-4])/);
  if (mQ2) return `${mQ2[1]}-Q${mQ2[2]}`;

  // Pattern: English month names — Jan_2024, January_2024, 2024_Jan
  const engMonths: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04',
    june: '06', july: '07', august: '08', september: '09',
    october: '10', november: '11', december: '12',
  };
  const monthMatch = fileName.toLowerCase().match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/
  );
  if (monthMatch) {
    const monthNum = engMonths[monthMatch[1]];
    const yearMatch = fileName.match(/(\d{4})/);
    if (monthNum && yearMatch) {
      return `${yearMatch[1]}-${monthNum}`;
    }
  }

  return null;
}

/**
 * Merge multiple periodic files into unified multi-period structure.
 * Transforms: {file per period, cols = metrics} → {cols = periods per metric}
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
    // Not enough periodic files to merge, return as-is
    return summaries;
  }

  const periods = [...filesByPeriod.keys()].sort();
  console.log(`[Merger] Merging ${periods.length} periodic files: ${periods.join(', ')}`);

  // Detect columns (metrics) from first file
  const firstFile = filesByPeriod.get(periods[0])!;
  const firstSheet = firstFile.sheets[0];
  if (!firstSheet) return summaries;

  // Find header row (first row with entity-like column)
  let headerRowIdx = -1;
  let metricColumns: { colIdx: number; name: string }[] = [];

  for (let i = 0; i < Math.min(firstSheet.allRows.length, 10); i++) {
    const row = firstSheet.allRows[i];
    // Look for a row that has text in first column and values in others
    if (row.some(c => c.length > 1 && !/^\d+$/.test(c.trim()))) {
      headerRowIdx = i;
      // Columns after the first one are metrics
      for (let j = 1; j < row.length; j++) {
        const name = row[j]?.trim();
        if (name && name.length > 1) {
          metricColumns.push({ colIdx: j, name: name.replace(/\s+/g, '') });
        }
      }
      break;
    }
  }

  // If we couldn't detect header from data rows, use column headers
  if (headerRowIdx === -1 || metricColumns.length === 0) {
    // Try using the sheet's column headers directly
    if (firstSheet.columns.length > 1) {
      for (let j = 1; j < firstSheet.columns.length; j++) {
        const name = firstSheet.columns[j]?.trim();
        if (name && name.length > 0) {
          metricColumns.push({ colIdx: j, name });
        }
      }
      headerRowIdx = 0; // data starts at first row
    }

    if (metricColumns.length === 0) {
      console.warn('[Merger] Cannot detect header row or metric columns');
      return summaries;
    }
  }

  // Detect entity column (first non-numeric column)
  const entityCol = 0;

  // Collect all entities across all files
  const allEntities: Set<string> = new Set();
  for (const [, file] of filesByPeriod) {
    const sheet = file.sheets[0];
    if (!sheet) continue;
    const rows = sheet.allRows;
    const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
    for (let i = startRow; i < rows.length; i++) {
      const entity = rows[i][entityCol]?.trim();
      if (entity && entity.length > 0) {
        allEntities.add(entity);
      }
    }
  }

  if (allEntities.size === 0) {
    console.warn('[Merger] No entities found');
    return summaries;
  }

  // Build merged sheet for each metric column
  const mergedSheets: SheetSummary[] = [];

  for (const { colIdx, name } of metricColumns) {
    const columns = [firstSheet.columns[entityCol] || '項目', ...periods];
    const allRows: string[][] = [];
    const sampleRows: string[][] = [];

    for (const entity of allEntities) {
      const row: string[] = [entity];
      for (const period of periods) {
        const file = filesByPeriod.get(period)!;
        const sheet = file.sheets[0];
        if (!sheet) {
          row.push('');
          continue;
        }
        // Find this entity's row in this file
        const dataRows = sheet.allRows;
        const entityRow = dataRows.find(r => r[entityCol]?.trim() === entity);
        row.push(entityRow?.[colIdx]?.trim() || '');
      }
      allRows.push(row);
    }

    // Sample rows = first 3
    sampleRows.push(...allRows.slice(0, 3));

    mergedSheets.push({
      sheetName: name,
      columns,
      rowCount: allRows.length,
      sampleRows,
      allRows,
    });
  }

  // Build merged FileSummary
  const mergedFile: FileSummary = {
    fileName: `合併資料（${periods[0]}～${periods[periods.length - 1]}）`,
    fileSize: summaries.reduce((s, f) => s + f.fileSize, 0),
    sheets: mergedSheets,
  };

  console.log(`[Merger] Merged into ${mergedSheets.length} sheets, ${allEntities.size} entities, ${periods.length} periods`);

  // Return merged file + any non-period files
  return [mergedFile, ...nonPeriodFiles];
}
