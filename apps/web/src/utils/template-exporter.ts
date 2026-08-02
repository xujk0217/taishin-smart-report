/**
 * Exports a PPTX by sending the user's template + slide spec to the
 * authenticated AWS Python renderer in REAL mode, or the local /api fallback.
 */
import { saveAs } from 'file-saver';
import { clearAuthSession, getIdToken } from '../auth';
import { runtimeConfig } from '../runtime-config';
import type { SlideSpec } from '../types/slide-spec';

export interface TemplateChartData {
  chartId: string;
  dataKey: string;
  title: string;
  type: 'line' | 'bar' | 'pie';
  categories: string[];
  series: Array<{ name: string; data: number[] }>;
}

export interface TemplateExportData {
  charts: TemplateChartData[];
}

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
  template: File | null,
  slides: SlideSpec[],
  data: TemplateExportData,
  fileName = '分析報告.pptx',
  options: { jobId?: string } = {},
): Promise<void> {
  if (template && template.size > 6 * 1024 * 1024) {
    throw new Error('PPTX 範本需小於 6 MB，才能安全傳送至生成服務。');
  }
  if (!template && !options.jobId) throw new Error('請先上傳 PPTX 範本。');
  if (runtimeConfig.mode !== 'REAL' && !template) throw new Error('本機生成需要目前瀏覽器中的 PPTX 範本。');
  const templateB64 = template && !options.jobId ? await fileToBase64(template) : undefined;

  // Prepare chart data for the backend
  const body = {
    spec: slides,
    data,
    ...(options.jobId ? { jobId: options.jobId } : { template: templateB64 }),
  };

  const realRendererUrl = runtimeConfig.mode === 'REAL' && runtimeConfig.plannerApiUrl
    ? new URL('v1/pptx/render', runtimeConfig.plannerApiUrl).toString()
    : '/api/render-pptx';
  const token = runtimeConfig.mode === 'REAL' ? await getIdToken() : null;
  if (runtimeConfig.mode === 'REAL' && !token) {
    throw new Error('登入已逾時，請重新使用 Cognito 登入後再生成 PPTX。');
  }
  const res = await fetch(realRendererUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    clearAuthSession();
    throw new Error('登入憑證已失效，請重新使用 Cognito 登入後再生成 PPTX。');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  const blob = await res.blob();
  saveAs(blob, fileName);
}
