import type { AIPlanningOutputDto, PlannerJobResponse } from '@smart-report/contracts';
import { createUploadResponseSchema, plannerJobResponseSchema } from '@smart-report/contracts';
import { getIdToken } from '../auth';
import { runtimeConfig } from '../runtime-config';

export class AwsPlannerClient {
  async create(files: File[], prompt: string): Promise<PlannerJobResponse> {
    const described = await Promise.all(files.map(async file => ({
      fileName: file.name,
      sizeBytes: file.size,
      sha256: await sha256(file),
    })));
    const slots = createUploadResponseSchema.parse(await this.request('/v1/plans/uploads', { method: 'POST', body: JSON.stringify({ files: described }) }));
    await Promise.all(slots.uploads.map(async (slot, index) => {
      const form = new FormData();
      Object.entries(slot.fields).forEach(([key, value]) => form.append(key, value));
      form.append('file', files[index]);
      const uploaded = await fetch(slot.uploadUrl, { method: 'POST', body: form });
      if (!uploaded.ok) throw new Error(`Excel 上傳失敗：${files[index].name}`);
    }));
    await this.request('/v1/plans', { method: 'POST', body: JSON.stringify({ jobId: slots.jobId, prompt }) });
    return this.get(slots.jobId);
  }

  async get(jobId: string): Promise<PlannerJobResponse> {
    return plannerJobResponseSchema.parse(await this.request(`/v1/plans/${jobId}`, { method: 'GET' }));
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

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const token = getIdToken();
    if (!token) throw new Error('請先使用 Cognito 登入');
    const response = await fetch(new URL(path.replace(/^\//, ''), runtimeConfig.plannerApiUrl).toString(), {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: token, ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({})) as { code?: string };
    if (!response.ok) throw new Error(body.code ?? `Planner API ${response.status}`);
    return body;
  }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
