import type { AIPlanningOutputDto, PlannerJobResponse, PlannerProjectSummary } from '@smart-report/contracts';
import { attachTemplateResponseSchema, createUploadResponseSchema, listPlannerJobsResponseSchema, plannerJobResponseSchema } from '@smart-report/contracts';
import { clearAuthSession, getIdToken } from '../auth';
import { runtimeConfig } from '../runtime-config';

export class AwsPlannerClient {
  async create(files: File[], prompt: string, template: File | null = null): Promise<PlannerJobResponse> {
    const uploadFiles = [...files.map(file => ({ file, kind: 'excel' as const })), ...(template ? [{ file: template, kind: 'template' as const }] : [])];
    const described = await Promise.all(uploadFiles.map(async ({ file, kind }) => ({
      kind,
      fileName: file.name,
      sizeBytes: file.size,
      sha256: await sha256(file),
    })));
    const slots = createUploadResponseSchema.parse(await this.request('/v1/plans/uploads', { method: 'POST', body: JSON.stringify({ files: described }) }));
    await Promise.all(slots.uploads.map(async (slot, index) => {
      const form = new FormData();
      Object.entries(slot.fields).forEach(([key, value]) => form.append(key, value));
      const source = uploadFiles[index].file;
      form.append('file', source);
      const uploaded = await fetch(slot.uploadUrl, { method: 'POST', body: form });
      if (!uploaded.ok) throw new Error(`${uploadFiles[index].kind === 'template' ? 'PPTX 範本' : 'Excel'} 上傳失敗：${source.name}`);
    }));
    await this.request('/v1/plans', { method: 'POST', body: JSON.stringify({ jobId: slots.jobId, prompt }) });
    return this.get(slots.jobId);
  }

  async get(jobId: string): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}`, { method: 'GET' }));
  }

  async attachTemplate(jobId: string, file: File): Promise<PlannerJobResponse> {
    const descriptor = { kind: 'template' as const, fileName: file.name, sizeBytes: file.size, sha256: await sha256(file) };
    const slot = attachTemplateResponseSchema.parse(await this.request(`/v1/plans/${jobId}/template/uploads`, { method: 'POST', body: JSON.stringify({ file: descriptor }) })).upload;
    const form = new FormData();
    Object.entries(slot.fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file);
    const uploaded = await fetch(slot.uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error(`PPTX 範本上傳失敗：${file.name}`);
    return this.get(jobId);
  }

  async list(): Promise<PlannerProjectSummary[]> {
    return listPlannerJobsResponseSchema.parse(await this.request('/v1/plans', { method: 'GET' })).projects;
  }

  async revise(jobId: string, instruction: string, version: number): Promise<PlannerJobResponse> {
    await this.request(`/v1/plans/${jobId}/revisions`, { method: 'POST', body: JSON.stringify({ instruction, expectedPlanVersion: version }) });
    return this.get(jobId);
  }

  async manualEdit(jobId: string, planningOutput: AIPlanningOutputDto, version: number): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}`, { method: 'PUT', body: JSON.stringify({ planningOutput, expectedPlanVersion: version, editSummary: 'Web JSON editor' }) }));
  }

  async approve(jobId: string, version: number): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}/approve`, { method: 'POST', body: JSON.stringify({ expectedPlanVersion: version }) }));
  }

  async retryPlanning(jobId: string): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}/retry`, { method: 'POST' }));
  }

  async retryCalculation(jobId: string): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}/calculations`, { method: 'POST' }));
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const token = await getIdToken();
    if (!token) throw new Error('登入已逾時，請重新使用 Cognito 登入');
    const response = await fetch(new URL(path.replace(/^\//, ''), runtimeConfig.plannerApiUrl).toString(), {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: token, ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({})) as { code?: string };
    if (response.status === 401) {
      clearAuthSession();
      throw new Error('登入憑證已失效，請重新使用 Cognito 登入');
    }
    if (!response.ok) throw new Error(body.code ?? `Planner API ${response.status}`);
    return body;
  }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
