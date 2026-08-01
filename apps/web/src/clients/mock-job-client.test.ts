import { describe, expect, it, vi } from 'vitest';
import { MockJobClient } from './mock-job-client';

const request = {
  topic: '比較三種低碳運輸方案並產生主管簡報',
  audience: '營運主管',
  style: '決策摘要',
  localFiles: [{ name: 'synthetic-input.xlsx', size: 4096 }],
};

describe('MockJobClient', () => {
  it('uses only synthetic local state and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new MockJobClient();
    const created = await client.createJob(request);

    expect(created.mode).toBe('MOCK');
    expect(created.status).toBe('MOCK_NEEDS_USER_DECISION');
    expect(created.request.localFiles[0].name).toBe('synthetic-input.xlsx');
    expect(created.planningMode).toBe('SYNTHETIC_EXAMPLE');
    expect(created.promptContract.userIntent).toBe(request.topic);
    expect(created.promptContract.targetAudience).toBe('待 AI Planner 判斷');
    expect(created.promptContract.charts[0].visualization).toBe('未決定');
    expect(created.deckPlan.slides).toHaveLength(5);
    expect(created.deckPlan.planningNotes[0]).toContain('非推論 synthetic fixture');
    expect(created.executionPlan.stages.map((stage) => stage.stageClass)).toEqual([
      'understand', 'acquire', 'analyze', 'compose', 'render-verify',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('requires plan approval and final approval around the mock stages', async () => {
    const client = new MockJobClient();
    let job = await client.createJob(request);
    job = await client.approvePlan(job.jobId);
    expect(job.status).toBe('MOCK_RUNNING');

    while (job.stages.some((stage) => stage.status === 'RUNNING')) {
      job = await client.advance(job.jobId);
    }

    expect(job.status).toBe('MOCK_NEEDS_USER_DECISION');
    job = await client.approveFinal(job.jobId);
    expect(job.status).toBe('MOCK_COMPLETED');
    expect(job.finalApprovalRequired).toBe(false);
  });
});
