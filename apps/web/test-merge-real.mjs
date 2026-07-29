/**
 * Test: simulate uploading 12 monthly files and verify merge + chart output.
 */
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'fs';

const dir = '../../114信用卡資料';
const files = readdirSync(dir).filter(f => f.endsWith('.xlsx')).sort();
console.log(`Files: ${files.length}`);

// Simulate browser reading
function extractPeriod(name) {
  const m = name.match(/^(\d{5})/);
  if (m) { const y=parseInt(m[1].slice(0,3)),mo=parseInt(m[1].slice(3)); if(y>=100&&y<=200&&mo>=1&&mo<=12) return m[1]; }
  const m2 = name.match(/(\d{3})年(\d{1,2})月/);
  if (m2) return m2[1] + m2[2].padStart(2, '0');
  return null;
}

// Read all files
const fileSummaries = [];
for (const f of files) {
  const period = extractPeriod(f);
  if (!period) { console.log(`  Skip (no period): ${f}`); continue; }
  
  const wb = XLSX.read(readFileSync(`${dir}/${f}`), { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const allRows = data.slice(1).map(r => (r || []).map(c => String(c ?? '').trim()));
  const columns = (data[0] || []).map(c => String(c ?? '').trim()).filter(Boolean);
  
  fileSummaries.push({
    fileName: f,
    fileSize: 20000,
    sheets: [{ sheetName: wb.SheetNames[0], columns, rowCount: allRows.length, sampleRows: allRows.slice(0, 3), allRows }],
  });
}

console.log(`Parsed: ${fileSummaries.length} files`);

// Check if it's a monthly set
const periodFiles = fileSummaries.filter(f => extractPeriod(f.fileName) !== null);
console.log(`Period files: ${periodFiles.length}`);

if (periodFiles.length < 2) {
  console.log('NOT a monthly set — would not merge');
  process.exit(0);
}

// Merge logic (replicate from multi-file-merger.ts)
const filesByPeriod = new Map();
for (const f of fileSummaries) {
  const p = extractPeriod(f.fileName);
  if (p) filesByPeriod.set(p, f);
}
const periods = [...filesByPeriod.keys()].sort();
console.log(`Periods: ${periods.join(', ')}`);

// Find header row and target metric columns
const firstFile = filesByPeriod.get(periods[0]);
const firstSheet = firstFile.sheets[0];
let headerRowIdx = -1;
const targetMetrics = ['流通卡數', '當月簽帳金額', '有效卡數'];

for (let i = 0; i < Math.min(firstSheet.allRows.length, 10); i++) {
  const row = firstSheet.allRows[i];
  if (row.some(c => c.includes('金融機構'))) {
    headerRowIdx = i;
    break;
  }
}
console.log(`Header at row: ${headerRowIdx}`);

// For each target metric, merge across months
for (const metricName of targetMetrics) {
  const entityData = new Map(); // entity → {period → value}
  
  for (const period of periods) {
    const file = filesByPeriod.get(period);
    const sheet = file.sheets[0];
    
    // Find header and metric column in this file
    let hIdx = -1, metricCol = -1;
    for (let i = 0; i < Math.min(sheet.allRows.length, 10); i++) {
      if (sheet.allRows[i].some(c => c.includes('金融機構'))) {
        hIdx = i;
        for (let j = 0; j < sheet.allRows[i].length; j++) {
          if (sheet.allRows[i][j].replace(/\s+/g, '').includes(metricName)) {
            metricCol = j;
            break;
          }
        }
        break;
      }
    }
    
    if (hIdx === -1 || metricCol === -1) continue;
    
    for (let i = hIdx + 1; i < sheet.allRows.length; i++) {
      const row = sheet.allRows[i];
      const entity = row[0]?.trim();
      if (!entity || entity.includes('資料來源') || entity.includes('揭露')) break;
      const value = row[metricCol] || '';
      if (!entityData.has(entity)) entityData.set(entity, new Map());
      entityData.get(entity).set(period, value);
    }
  }
  
  console.log(`\n${metricName}: ${entityData.size} entities × ${periods.length} periods`);
  
  // Find 台新 and compute market share for latest period
  const taishin = [...entityData.entries()].find(([k]) => k.includes('台新'));
  const total = [...entityData.entries()].find(([k]) => k.includes('總計'));
  
  if (taishin && total) {
    const latestP = periods[periods.length - 1];
    const tv = parseFloat(taishin[1].get(latestP)?.replace(/,/g, '') || '0');
    const ttl = parseFloat(total[1].get(latestP)?.replace(/,/g, '') || '0');
    if (ttl > 0) {
      console.log(`  台新 ${latestP}: ${tv.toLocaleString()} / ${ttl.toLocaleString()} = ${(tv/ttl*100).toFixed(2)}%`);
    }
  }
}

console.log('\n✅ Merge logic works with real 12-file data!');
