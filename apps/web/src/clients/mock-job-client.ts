import type { JobClient } from './job-client';
import type { JobRequest, JobSnapshot, JobStage } from '../types/job';
import { createSyntheticPlanningFixture } from './synthetic-planning-fixture';

const STAGES: JobStage[] = [
  {
    id: 'understand',
    label: '1 · Understand / Contract',
    description: 'Synthetic PromptContract placeholder is waiting for user acknowledgement.',
    status: 'WAITING',
    gate: 'NEEDS_USER_DECISION',
    attempt: 1,
  },
  {
    id: 'acquire',
    label: '2 · Acquire / Research',
    description: 'The real AI decides required data; controlled data and research tools run only here.',
    status: 'PENDING',
    gate: null,
    attempt: 0,
  },
  {
    id: 'analyze',
    label: '3 · Analyze / Evidence',
    description: 'Approved formulas and analysis tools derive evidence-backed findings only here.',
    status: 'PENDING',
    gate: null,
    attempt: 0,
  },
  {
    id: 'compose',
    label: '4 · Compose / DeckPlan',
    description: 'The real AI chooses narrative, visuals, and page content from accepted evidence.',
    status: 'PENDING',
    gate: null,
    attempt: 0,
  },
  {
    id: 'render-verify',
    label: '5 · Render / Independent Verify',
    description: 'Renderer and independent inspector bind editable artifacts to accepted references.',
    status: 'PENDING',
    gate: null,
    attempt: 0,
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockJobClient implements JobClient {
  private readonly jobs = new Map<string, JobSnapshot>();
  private sequence = 1;

  async createJob(request: JobRequest): Promise<JobSnapshot> {
    const jobId = `mock-job-${String(this.sequence++).padStart(3, '0')}`;
    const fixture = createSyntheticPlanningFixture(request.topic);
    const snapshot: JobSnapshot = {
      jobId,
      mode: 'MOCK',
      planningMode: 'SYNTHETIC_EXAMPLE',
      status: 'MOCK_NEEDS_USER_DECISION',
      createdAt: new Date().toISOString(),
      request: clone(request),
      ...fixture,
      planVersion: 1,
      stages: clone(STAGES),
      finalApprovalRequired: true,
      artifactMessage: 'AI Planner、renderer 與產物功能尚未啟用；目前只展示非推論 UI fixture。',
    };
    this.jobs.set(jobId, snapshot);
    return clone(snapshot);
  }

  async getJob(jobId: string): Promise<JobSnapshot> {
    return clone(this.requireJob(jobId));
  }

  async approvePlan(jobId: string): Promise<JobSnapshot> {
    const job = this.requireJob(jobId);
    const understand = job.stages.find((stage) => stage.id === 'understand');
    const acquire = job.stages.find((stage) => stage.id === 'acquire');
    if (!understand || !acquire || understand.gate !== 'NEEDS_USER_DECISION') {
      throw new Error('Synthetic planning fixture is not waiting for acknowledgement.');
    }
    understand.status = 'COMPLETED';
    understand.gate = 'PASS';
    acquire.status = 'RUNNING';
    acquire.attempt = 1;
    job.status = 'MOCK_RUNNING';
    return clone(job);
  }

  async advance(jobId: string): Promise<JobSnapshot> {
    const job = this.requireJob(jobId);
    const runningIndex = job.stages.findIndex((stage) => stage.status === 'RUNNING');
    if (runningIndex < 0) {
      throw new Error('No mock stage is running.');
    }
    const current = job.stages[runningIndex];
    current.status = 'COMPLETED';
    current.gate = 'PASS';
    const next = job.stages.slice(runningIndex + 1).find((stage) => stage.status === 'PENDING');
    if (next) {
      next.status = 'RUNNING';
      next.attempt = 1;
    } else {
      job.status = 'MOCK_NEEDS_USER_DECISION';
      job.artifactMessage = 'Synthetic stage movement completed. No data, model, research, render, or artifact operation occurred.';
    }
    return clone(job);
  }

  async approveFinal(jobId: string): Promise<JobSnapshot> {
    const job = this.requireJob(jobId);
    if (job.stages.some((stage) => stage.status === 'RUNNING' || stage.status === 'PENDING')) {
      throw new Error('Mock stages must finish before final approval.');
    }
    job.status = 'MOCK_COMPLETED';
    job.finalApprovalRequired = false;
    job.artifactMessage = 'Mock workflow completed. No real artifact was created, uploaded, or published.';
    return clone(job);
  }

  private requireJob(jobId: string): JobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown mock job: ${jobId}`);
    return job;
  }
}
