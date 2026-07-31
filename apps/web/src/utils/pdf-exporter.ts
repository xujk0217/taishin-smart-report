/**
 * PDF export — renders the slide deck as a multi-page PDF.
 * Uses jsPDF which is lightweight and works entirely in-browser.
 */
import { saveAs } from 'file-saver';
import type { SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';
import { resolveChart } from './provenance';

export async function exportPDF(
  slides: SlideSpec[],
  result: ComputeResult | null,
  fileName = '台新信用卡分析報告.pdf',
): Promise<void> {
  // Dynamic import to keep bundle small
  const { jsPDF } = await import('jspdf');

  // 16:9 landscape
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [338, 190] });
  const W = 338;
  const H = 190;
  const MARGIN = 15;

  for (let idx = 0; idx < slides.length; idx++) {
    if (idx > 0) pdf.addPage();
    const spec = slides[idx];
    const isCentered = spec.layout === 'cover' || spec.layout === 'section_title' || spec.layout === 'backcover';

    // Background
    if (spec.background !== '002') {
      pdf.setFillColor(248, 232, 232);
      pdf.rect(0, 0, W, H, 'F');
    }

    if (isCentered) {
      // Centered layouts
      const title = spec.elements.find(e => e.type === 'title');
      const subtitle = spec.elements.find(e => e.type === 'subtitle');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(spec.layout === 'cover' ? 28 : 24);
      pdf.setTextColor(34, 34, 34);
      if (title?.content) {
        pdf.text(title.content, W / 2, H / 2 - (subtitle ? 10 : 0), { align: 'center' });
      }
      if (subtitle?.content) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(14);
        pdf.setTextColor(85, 85, 85);
        pdf.text(subtitle.content, W / 2, H / 2 + 12, { align: 'center' });
      }
    } else {
      // Content layout
      let y = MARGIN;
      for (const el of spec.elements) {
        if (y > H - 20) break;

        switch (el.type) {
          case 'heading':
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(192, 27, 43);
            pdf.text(el.content ?? '', MARGIN, y);
            y += 10;
            break;

          case 'chart': {
            const chart = resolveChart(el.dataKey, result);
            if (chart) {
              pdf.setFont('helvetica', 'normal');
              pdf.setFontSize(11);
              pdf.setTextColor(44, 62, 80);
              pdf.text(`[圖表] ${chart.title}`, MARGIN, y);
              y += 6;
              // Draw simplified chart data as text
              for (const s of chart.series.slice(0, 3)) {
                const vals = s.data.slice(-4).map(v => v.toFixed(1) + '%').join(' → ');
                pdf.setFontSize(9);
                pdf.text(`  ${s.name}: ${vals}`, MARGIN + 5, y);
                y += 5;
              }
              y += 4;
            }
            break;
          }

          case 'kpi_block':
            if (el.metrics?.length) {
              for (const m of el.metrics) {
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(14);
                pdf.setTextColor(192, 27, 43);
                pdf.text(m.value, MARGIN, y);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(9);
                pdf.setTextColor(127, 140, 141);
                pdf.text(`  ${m.label}${m.rank ? ` #${m.rank}` : ''}${m.trend ?? ''}`, MARGIN + 30, y);
                y += 7;
              }
              y += 3;
            }
            break;

          case 'comparison':
            if (el.entities?.length) {
              pdf.setFontSize(10);
              for (const e of el.entities.slice(0, 6)) {
                pdf.setTextColor(e.highlight ? 192 : 44, e.highlight ? 27 : 62, e.highlight ? 43 : 80);
                pdf.setFont('helvetica', e.highlight ? 'bold' : 'normal');
                pdf.text(`${e.name}: ${e.value}`, MARGIN, y);
                y += 5.5;
              }
              y += 3;
            }
            break;

          case 'insight':
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(10);
            pdf.setTextColor(39, 174, 96);
            const insightLines = pdf.splitTextToSize(`💡 ${el.content ?? ''}`, W - MARGIN * 2);
            pdf.text(insightLines, MARGIN, y);
            y += insightLines.length * 5 + 3;
            break;

          case 'text_block':
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(44, 62, 80);
            const textLines = pdf.splitTextToSize(el.content ?? '', W - MARGIN * 2);
            pdf.text(textLines, MARGIN, y);
            y += textLines.length * 5 + 3;
            break;

          case 'bullet_list':
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(44, 62, 80);
            for (const item of el.items ?? []) {
              const lines = pdf.splitTextToSize(`• ${item}`, W - MARGIN * 2 - 5);
              pdf.text(lines, MARGIN + 3, y);
              y += lines.length * 5 + 2;
            }
            y += 2;
            break;

          case 'table':
            if (el.headers?.length && el.rows?.length) {
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(9);
              pdf.setTextColor(255, 255, 255);
              pdf.setFillColor(192, 27, 43);
              pdf.rect(MARGIN, y - 3.5, W - MARGIN * 2, 5.5, 'F');
              const colW = (W - MARGIN * 2) / el.headers.length;
              el.headers.forEach((h, i) => pdf.text(h, MARGIN + i * colW + 2, y));
              y += 5;
              pdf.setFont('helvetica', 'normal');
              pdf.setTextColor(44, 62, 80);
              for (const row of el.rows.slice(0, 8)) {
                row.forEach((cell, i) => pdf.text(String(cell), MARGIN + i * colW + 2, y));
                y += 4.5;
              }
              y += 3;
            }
            break;

          case 'source':
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(8);
            pdf.setTextColor(149, 165, 166);
            pdf.text(`資料來源：${el.content ?? ''}`, MARGIN, H - 10);
            break;
        }
      }
    }

    // Page number (except cover)
    if (spec.layout !== 'cover') {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(149, 165, 166);
      pdf.text(String(spec.page), W - MARGIN, H - 8, { align: 'right' });
    }
  }

  const blob = pdf.output('blob');
  saveAs(blob, fileName);
}
