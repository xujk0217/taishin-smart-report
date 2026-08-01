/**
 * Exports a PPTX by sending the user's template + slide spec to the
 * python-pptx serverless function at /api/render-pptx.
 */
import { saveAs } from 'file-saver';
import type { SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';

/**
 * Converts a File to a base64 string.
 */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Calls the serverless python-pptx renderer.
 */
export async function exportWithTemplate(
  template: File,
  slides: SlideSpec[],
  result: ComputeResult | null,
  fileName = '分析報告.pptx',
): Promise<void> {
  const templateB64 = await fileToBase64(template);

  // Prepare chart data for the backend
  const chartData = result?.charts.map(c => ({
    chartId: c.chartId,
    dataKey: c.chartId,
    title: c.title,
    type: c.type,
    categories: c.categories,
    series: c.series.map(s => ({ name: s.name, data: s.data })),
  })) ?? [];

  const body = {
    template: templateB64,
    spec: slides,
    data: { charts: chartData },
  };

  const res = await fetch('/api/render-pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  const blob = await res.blob();
  saveAs(blob, fileName);
}
