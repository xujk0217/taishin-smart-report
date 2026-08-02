export type FeatureMode = 'MOCK' | 'NOT_ENABLED' | 'REAL';

export type CapabilityKey =
  | 'authentication'
  | 'fileUpload'
  | 'dynamicPlanner'
  | 'agentRuntime'
  | 'webResearch'
  | 'renderer'
  | 'bedrock'
  | 'artifactDelivery';

export interface FeatureAvailability {
  key: CapabilityKey;
  label: string;
  mode: FeatureMode;
  description: string;
}

export type MockJobStatus = 'MOCK_NEEDS_USER_DECISION' | 'MOCK_RUNNING' | 'MOCK_COMPLETED';
export type StageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WAITING';
export type GateOutcome = 'PASS' | 'NEEDS_USER_DECISION' | null;
export type RequirementOrigin = 'explicit' | 'inferred' | 'recommended';
export type SlideKind = 'cover' | 'content' | 'section' | 'appendix' | 'back-cover';
export type GovernanceStageClass = 'understand' | 'acquire' | 'analyze' | 'compose' | 'render-verify';
export type ToolCategory = 'contract' | 'data-read' | 'research' | 'calculation' | 'analysis' | 'deck-planning' | 'rendering' | 'inspection';

export interface JobRequest {
  topic: string;
  audience: string;
  style: string;
  localFiles: Array<{ name: string; size: number }>;
}

export interface MetricRequirement {
  metricId: string;
  name: string;
  purpose: string;
  definitionNeeded: string;
  origin: RequirementOrigin;
  required: boolean;
}

export interface ChartRequirement {
  chartId: string;
  title: string;
  visualization: string;
  purpose: string;
  dataRequirements: string[];
  origin: RequirementOrigin;
  rationale: string;
  required: boolean;
}

export interface InsightRequirement {
  insightId: string;
  question: string;
  purpose: string;
  evidenceNeeded: string[];
  origin: RequirementOrigin;
  required: boolean;
}

export interface FlexibleRequirement {
  requirementId: string;
  category: string;
  description: string;
  origin: RequirementOrigin;
  acceptanceCriteria: string[];
}

export interface PromptContract {
  contractVersion: 'prompt-contract-v2';
  userIntent: string;
  presentationGoal: string;
  targetAudience: string;
  language: string;
  recommendedPageCount: number;
  pageCountOrigin: RequirementOrigin;
  pageCountRationale: string;
  toneAndStyle: string[];
  visualDirection: string[];
  metrics: MetricRequirement[];
  charts: ChartRequirement[];
  insights: InsightRequirement[];
  dataRequirements: string[];
  researchRequirements: string[];
  formulaRequirements: string[];
  contentConstraints: string[];
  outputRequirements: string[];
  customRequirements: FlexibleRequirement[];
  assumptions: string[];
  ambiguities: string[];
}

export interface ExecutionStagePlan {
  stageId: string;
  stageClass: GovernanceStageClass;
  objective: string;
  plannedActivities: string[];
  requiredInputs: string[];
  allowedToolCategories: ToolCategory[];
  requiredOutputs: string[];
  validationChecks: string[];
  completionCriteria: string[];
  requiresUserApproval: boolean;
}

export interface FiveStageExecutionPlan {
  stages: ExecutionStagePlan[];
}

export interface SlidePlan {
  pageNumber: number;
  kind: SlideKind;
  title: string;
  communicationGoal: string;
  keyMessage: string;
  contentElements: string[];
  metricIds: string[];
  chartIds: string[];
  insightIds: string[];
  customRequirementIds: string[];
  evidenceRequirements: string[];
  layoutGuidance: string;
  speakerNotesGuidance: string;
  editable: boolean;
}

export interface DeckPlan {
  planVersion: 'deck-plan-v2';
  title: string;
  subtitle: string;
  totalPages: number;
  narrativeStrategy: string;
  narrativeArc: string[];
  slides: SlidePlan[];
  unresolvedQuestions: string[];
  planningNotes: string[];
}

export interface JobStage {
  id: string;
  label: string;
  description: string;
  status: StageStatus;
  gate: GateOutcome;
  attempt: number;
}

export interface JobSnapshot {
  jobId: string;
  mode: 'MOCK';
  planningMode: 'SYNTHETIC_EXAMPLE';
  status: MockJobStatus;
  createdAt: string;
  request: JobRequest;
  promptContract: PromptContract;
  executionPlan: FiveStageExecutionPlan;
  deckPlan: DeckPlan;
  planVersion: number;
  stages: JobStage[];
  finalApprovalRequired: boolean;
  artifactMessage: string;
}
