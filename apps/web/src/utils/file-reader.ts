/**
 * Unified file reader: supports Excel (.xlsx/.xls/.xlsm), CSV, and PDF.
 * All formats are converted to the same FileSummary shape that the pipeline
 * and metric engine expect.
 */
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { FileSummary, SheetSummary } from './excel-reader';

// ─── Public API ──────────────────────────────────────────────

const EXCEL_EXTS = /\.(xlsx|xlsm|xls)$/i;
const CSV_EXTS = /\.(csv|tsv|txt)$/i;
const PDF_EXT = /\.pdf$/i;

export function isSupportedFile(name: string): boolean {
  return EXCEL_EXTS.test(name) || CSV_EXTS.test(name) || PDF_EXT.test(name);
}

export function supportedExtensions(): string {
  return '.xlsx, .xlsm, .xls, .csv, .tsv, .pdf';
}

/**
 * Read a single file (any supported format) and return a FileSummary.
 */
export async function readFile(file: File): Promise<FileSummary> {
  const name = file.name.toLowerCase();

  if (EXCEL_EXTS.test(name)) {
    return readExcel(file);
  }
  if (CSV_EXTS.test(name)) {
    return readCSV(file);
  }
  if (PDF_EXT.test(name)) {
    return readPDF(file);
  }

  // Unsupported — return empty shell
  return { fileName: file.name, fileSize: file.size, sheets: [] };
}

/**
 * Read multiple files of any supported format.
 */
export async function readAllFiles(files: File[]): Promise<FileSummary[]> {
  const results: FileSummary[] = [];
  for (const file of files) {
    try {
      results.push(await readFile(file));
    } catch (err) {
      console.error(`Failed to read ${file.name}:`, err);
      results.push({ fileName: file.name, fileSize: file.size, sheets: [] });
    }
  }
  return results;
}

// ─── Excel ───────────────────────────────────────────────────

async function readExcel(file: File): Promise<FileSummary> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheets: SheetSummary[] = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    if (jsonData.length === 0) continue;

    const columns = (jsonData[0] || []).map(c => String(c ?? '').trim()).filter(Boolean);
    const sampleRows = jsonData.slice(1, 4).map(row =>
      (row || []).map(cell => String(cell ?? '').trim())
    );
    const allRows = jsonData.slice(1).map(row =>
      (row || []).map(cell => String(cell ?? '').trim())
    );

    sheets.push({ sheetName, columns, rowCount: jsonData.length - 1, sampleRows, allRows });
  }

  return { fileName: file.name, fileSize: file.size, sheets };
}

// ─── CSV/TSV ─────────────────────────────────────────────────

async function readCSV(file: File): Promise<FileSummary> {
  const text = await file.text();

  return new Promise((resolve) => {
    Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as string[][];
        if (rows.length === 0) {
          resolve({ fileName: file.name, fileSize: file.size, sheets: [] });
          return;
        }

        const columns = rows[0].map(c => String(c ?? '').trim()).filter(Boolean);
        const dataRows = rows.slice(1).map(row => row.map(cell => String(cell ?? '').trim()));

        const sheet: SheetSummary = {
          sheetName: file.name.replace(/\.[^.]+$/, ''),
          columns,
          rowCount: dataRows.length,
          sampleRows: dataRows.slice(0, 3),
          allRows: dataRows,
        };

        resolve({ fileName: file.name, fileSize: file.size, sheets: [sheet] });
      },
    });
  });
}

// ─── PDF ─────────────────────────────────────────────────────

async function readPDF(file: File): Promise<FileSummary> {
  try {
    // Dynamic import to keep the main bundle smaller
    const pdfjsLib = await import('pdfjs-dist');

    // Set up the worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const allText: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();
      if (pageText) allText.push(pageText);
    }

    // Try to detect tabular structure: split by newlines, then by consistent delimiters
    const fullText = allText.join('\n');
    const lines = fullText.split(/\n/).filter(l => l.trim());

    // Attempt to parse as table if lines have consistent column counts
    const tabRows = lines.map(l => l.split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean));
    const colCounts = tabRows.map(r => r.length);
    const modeCount = colCounts.sort((a, b) => b - a)[0] ?? 0;
    const isTabular = modeCount >= 3 && colCounts.filter(c => c === modeCount).length > lines.length * 0.5;

    if (isTabular && tabRows.length > 1) {
      const columns = tabRows[0];
      const dataRows = tabRows.slice(1);
      const sheet: SheetSummary = {
        sheetName: 'PDF 表格',
        columns,
        rowCount: dataRows.length,
        sampleRows: dataRows.slice(0, 3),
        allRows: dataRows,
      };
      return { fileName: file.name, fileSize: file.size, sheets: [sheet] };
    }

    // Non-tabular: treat as a single-column text document
    const sheet: SheetSummary = {
      sheetName: 'PDF 內容',
      columns: ['文字內容'],
      rowCount: lines.length,
      sampleRows: lines.slice(0, 3).map(l => [l.slice(0, 200)]),
      allRows: lines.map(l => [l]),
    };

    return { fileName: file.name, fileSize: file.size, sheets: [sheet] };
  } catch (err) {
    console.error('[PDF] Failed to parse:', err);
    // Fallback: return the file name so the pipeline knows it exists
    return {
      fileName: file.name,
      fileSize: file.size,
      sheets: [{
        sheetName: 'PDF（無法解析）',
        columns: ['狀態'],
        rowCount: 1,
        sampleRows: [['PDF 檔案已上傳但無法自動擷取表格資料']],
        allRows: [['PDF 檔案已上傳但無法自動擷取表格資料']],
      }],
    };
  }
}
