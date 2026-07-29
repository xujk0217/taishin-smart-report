/**
 * Browser-side Excel reader using SheetJS.
 * Extracts sheet names, column headers, and sample data from uploaded files.
 * This summary is sent to AI for accurate plan generation.
 */
import * as XLSX from 'xlsx';

export interface SheetSummary {
  sheetName: string;
  columns: string[];
  rowCount: number;
  sampleRows: string[][];  // first 3 data rows (for AI summary)
  allRows: string[][];     // ALL data rows (for metric engine)
}

export interface FileSummary {
  fileName: string;
  fileSize: number;
  sheets: SheetSummary[];
}

/**
 * Read an Excel file and extract structure summary.
 */
export async function readExcelFile(file: File): Promise<FileSummary> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheets: SheetSummary[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

    if (jsonData.length === 0) continue;

    // First row = headers
    const columns = (jsonData[0] || []).map(c => String(c ?? '').trim()).filter(Boolean);
    
    // Sample rows (rows 1-3, skip header)
    const sampleRows = jsonData.slice(1, 4).map(row =>
      (row || []).map(cell => String(cell ?? '').trim())
    );

    // ALL rows for metric engine
    const allRows = jsonData.slice(1).map(row =>
      (row || []).map(cell => String(cell ?? '').trim())
    );

    sheets.push({
      sheetName,
      columns,
      rowCount: jsonData.length - 1,  // exclude header
      sampleRows,
      allRows,
    });
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    sheets,
  };
}

/**
 * Read multiple Excel files and return all summaries.
 */
export async function readAllExcelFiles(files: File[]): Promise<FileSummary[]> {
  const summaries: FileSummary[] = [];
  for (const file of files) {
    try {
      const summary = await readExcelFile(file);
      summaries.push(summary);
    } catch (err) {
      console.error(`Failed to read ${file.name}:`, err);
      summaries.push({
        fileName: file.name,
        fileSize: file.size,
        sheets: [],
      });
    }
  }
  return summaries;
}

/**
 * Convert file summaries to a concise text for AI prompt.
 */
export function summariesToText(summaries: FileSummary[]): string {
  const parts: string[] = [];

  for (const file of summaries) {
    parts.push(`📄 ${file.fileName} (${(file.fileSize / 1024).toFixed(0)} KB)`);
    for (const sheet of file.sheets) {
      parts.push(`  工作表「${sheet.sheetName}」: ${sheet.rowCount} 筆資料`);
      parts.push(`  欄位: ${sheet.columns.join(', ')}`);
      if (sheet.sampleRows.length > 0) {
        parts.push(`  範例: ${sheet.sampleRows[0].slice(0, 6).join(' | ')}`);
      }
    }
  }

  return parts.join('\n');
}
