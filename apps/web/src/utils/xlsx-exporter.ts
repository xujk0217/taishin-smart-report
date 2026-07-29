/**
 * Companion evidence workbook.
 *
 * Ships alongside the PPTX so a reviewer can audit every number in the deck:
 * which cell it came from, which formula produced it, and which slide uses it.
 */
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';
import { traceElement } from './provenance';

export async function exportEvidenceWorkbook(
  slides: SlideSpec[],
  result: ComputeResult | null,
  fileName = '台新信用卡分析報告_來源附件.xlsx',
): Promise<void> {
  if (!result) throw new Error('沒有可匯出的計算結果');

  const wb = XLSX.utils.book_new();

  // ── 1. Overview ────────────────────────────────────────────
  const overview = [
    ['項目', '內容'],
    ['產生時間', new Date().toLocaleString('zh-TW')],
    ['簡報頁數', slides.length],
    ['引用工作表數', result.summary.sheetsUsed],
    ['銀行家數', result.summary.totalEntities],
    ['期間數', result.summary.totalPeriods],
    ['原始儲存格數', result.sourceRefs.length],
    ['計算指標數', result.metrics.length],
    ['圖表數', result.charts.length],
    [],
    ['說明', '本檔案為簡報的來源證據附件。每個指標都可依 SourceID 回查原始儲存格。'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overview), '總覽');

  // ── 2. Source manifest ─────────────────────────────────────
  const sourceRows = [
    ['SourceID', '檔案', '工作表', '儲存格', '銀行', '期間', '原始值', '解析數值'],
    ...result.sourceRefs.map(s => [
      s.sourceId, s.fileName, s.sheetName, s.cellAddress,
      s.entity, s.period, s.rawValue, s.value,
    ]),
  ];
  const wsSource = XLSX.utils.aoa_to_sheet(sourceRows);
  wsSource['!cols'] = [
    { wch: 11 }, { wch: 26 }, { wch: 20 }, { wch: 9 },
    { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSource, '來源清單');

  // ── 3. Metrics with formula and computation ────────────────
  const metricRows = [
    ['MetricID', '指標名稱', '銀行', '期間', '數值', '單位', '排名', '總家數', '公式', '計算過程', '引用 SourceID'],
    ...result.metrics.map(m => [
      m.metricId, m.metricName, m.entity, m.period, m.value, m.unit,
      m.rank ?? '', m.rankTotal ?? '', m.formula, m.computationStep,
      m.sourceRefs.map(s => s.sourceId).join(', '),
    ]),
  ];
  const wsMetric = XLSX.utils.aoa_to_sheet(metricRows);
  wsMetric['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 6 },
    { wch: 6 }, { wch: 8 }, { wch: 28 }, { wch: 34 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMetric, '指標計算');

  // ── 4. Chart data, one block per chart ─────────────────────
  const chartRows: (string | number)[][] = [];
  for (const c of result.charts) {
    chartRows.push([c.title]);
    chartRows.push(['類型', c.type === 'bar' ? '柱狀圖' : '折線圖']);
    chartRows.push(['期間/類別', ...c.categories]);
    for (const s of c.series) {
      chartRows.push([s.name, ...s.data]);
    }
    chartRows.push(['引用 MetricID', c.metricIds.slice(0, 30).join(', ')]);
    chartRows.push([]);
  }
  if (chartRows.length === 0) chartRows.push(['（無圖表）']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chartRows), '圖表資料');

  // ── 5. Slide-by-slide claim registry ───────────────────────
  const claimRows: (string | number)[][] = [
    ['頁碼', '版面', '段落', '元素類型', '內容摘要', '性質', '引用指標數', '引用儲存格數', '計算依據'],
  ];
  for (const slide of slides) {
    for (const el of slide.elements) {
      const prov = traceElement(el, result);
      claimRows.push([
        slide.page,
        slide.layout,
        slide.section ?? '',
        el.type,
        summarise(el),
        prov.kind === 'computed' ? '已計算' : prov.kind === 'narrative' ? 'AI 敘述' : '版面',
        prov.metrics.length,
        prov.sources.length,
        prov.steps.slice(0, 3).join(' ｜ '),
      ]);
    }
  }
  const wsClaim = XLSX.utils.aoa_to_sheet(claimRows);
  wsClaim['!cols'] = [
    { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 40 },
    { wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 50 },
  ];
  XLSX.utils.book_append_sheet(wb, wsClaim, '簡報內容溯源');

  // ── 6. Traceability check ──────────────────────────────────
  const unbacked = slides.flatMap(slide =>
    slide.elements
      .map(el => ({ slide, el, prov: traceElement(el, result) }))
      .filter(({ el, prov }) =>
        prov.kind === 'narrative' && prov.metrics.length === 0 && Boolean(numbersIn(el)),
      )
      .map(({ slide, el }) => [slide.page, el.type, summarise(el), '含數字但未對上計算結果']),
  );
  const auditRows = [
    ['檢查項目', '結果'],
    ['所有指標皆有來源儲存格', result.metrics.every(m => m.sourceRefs.length > 0) ? '通過' : '不通過'],
    ['所有圖表皆有引用指標', result.charts.every(c => c.metricIds.length > 0) ? '通過' : '不通過'],
    ['未對上計算結果的量化敘述', unbacked.length === 0 ? '無' : `${unbacked.length} 筆，見下方`],
    [],
    ...(unbacked.length > 0
      ? [['頁碼', '元素類型', '內容', '問題'], ...unbacked]
      : []),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(auditRows), '驗證報告');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([out], { type: 'application/octet-stream' }), fileName);
}

function summarise(el: SlideSpec['elements'][number]): string {
  if (el.content) return el.content.slice(0, 70);
  if (el.items?.length) return el.items.join('；').slice(0, 70);
  if (el.metrics?.length) return el.metrics.map(m => `${m.label} ${m.value}`).join('、').slice(0, 70);
  if (el.entities?.length) return el.entities.map(e => `${e.name} ${e.value}`).join('、').slice(0, 70);
  if (el.dataKey) return `圖表：${el.dataKey}`;
  return '';
}

function numbersIn(el: SlideSpec['elements'][number]): boolean {
  const text = [el.content, ...(el.items ?? [])].filter(Boolean).join(' ');
  return /\d/.test(text);
}
