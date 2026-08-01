import type { JobRequest, JobSnapshot } from '../types/job';

export interface JobClient {
  createJob(request: JobRequest): Promise<JobSnapshot>;
  getJob(jobId: string): Promise<JobSnapshot>;
  approvePlan(jobId: string): Promise<JobSnapshot>;
  advance(jobId: string): Promise<JobSnapshot>;
  approveFinal(jobId: string): Promise<JobSnapshot>;
}
