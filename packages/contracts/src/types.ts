import type {
  DataType,
  MetricUnit,
  JobStatus,
  ClaimStatus,
  ClaimDirection,
  ClaimMagnitude,
  SourceRole,
  FormulaPlanStatus,
  FindingSeverity,
} from './enums.js';

// ─── SourceRef ───────────────────────────────────────────────
export interface SourceRef {
  sourceId: string;
  sheetName: string;
  cellAddress: string;
  rawValue: string;
  normalizedValue: number;
  dataType: DataType;
  period: string;
  entity: string;
}

// ─── MetricRecord ────────────────────────────────────────────
export interface MetricRecord {
  metricId: string;
  metricName: string;
  formulaId: string;
  formulaDefinition: string;
  inputSourceIds: string[];
  computedValue: number;
  unit: MetricUnit;
  period: string;
  entity: string;
  rank?: number | null;
  rankTotal?: number | null;
  computationSteps: string[];
  valid: boolean;
  invalidReason?: string | null;
}

// ─── EvidencePacket ──────────────────────────────────────────
export interface UnsupportedRequest {
  metricName: string;
  reason: string;
  requiredPeriods?: string[];
  availablePeriods?: string[];
}

export interface EvidencePacket {
  packetId: string;
  jobId: string;
  workbook: {
    s3Uri: string;
    sha256: string;
  };
  formulaPlanId: string;
  sourceRefs: SourceRef[];
  metrics: MetricRecord[];
  chartDataSpecs: ChartDataSpec[];
  validationFindings: Finding[];
  unsupportedRequests: UnsupportedRequest[];
  frozen: boolean;
  frozenAt?: string | null;
  canonicalSha256?: string | null;
}

// ─── FormulaPlan ─────────────────────────────────────────────
export interface FormulaInput {
  field: string;
  sheet: string;
  entity?: string;
}

export interface FormulaDefinition {
  formulaId: string;
  name: string;
  definition: string;
  inputs: FormulaInput[];
  unit: string;
  displayFormat?: string;
  supported: boolean;
}

export interface UnsupportedFormula {
  name: string;
  reason: string;
  wouldRequire?: string[];
}

export interface FormulaPlan {
  planId: string;
  jobId: string;
  formulas: FormulaDefinition[];
  unsupported: UnsupportedFormula[];
  assumptions: string[];
  version: number;
  status: FormulaPlanStatus;
}

// ─── Claim ───────────────────────────────────────────────────
export interface ExtractedNumber {
  value: number;
  unit: string;
  metricId: string;
}

export interface Claim {
  claimId: string;
  claimKey: string;
  sourceRole: SourceRole;
  statement: string;
  extractedNumbers: ExtractedNumber[];
  evidenceIds: string[];
  businessImplication?: string;
  caveats?: string[];
  counterEvidence?: string[];
  direction?: ClaimDirection;
  magnitude?: ClaimMagnitude;
  status: ClaimStatus;
  rejectionReason?: string | null;
  conflictGroupId?: string | null;
}

// ─── ConflictGroup ───────────────────────────────────────────
export interface ConflictGroup {
  conflictGroupId: string;
  conflictType: 'direction' | 'numeric' | 'ranking';
  claimIds: string[];
  description: string;
  resolution: 'blocked' | 'resolved';
  evidenceMetricId?: string;
  correctValue?: number;
}

// ─── ClaimRegistry ───────────────────────────────────────────
export interface ClaimRegistry {
  packetId: string;
  accepted: Claim[];
  rejected: Claim[];
  conflicts: ConflictGroup[];
}

// ─── RoleInsight ─────────────────────────────────────────────
export interface RoleInsightMetadata {
  modelId: string;
  promptHash: string;
  skillVersion: string;
  generatedAt: string;
}

export interface RoleInsight {
  role: SourceRole;
  packetId: string;
  claims: Claim[];
  metadata: RoleInsightMetadata;
}

// ─── SlideDeckSpec ───────────────────────────────────────────
export interface ChartAxisSpec {
  label: string;
  format?: string;
  min?: number;
  max?: number;
}

export interface ChartSpec {
  type: 'line' | 'bar' | 'pie' | 'column' | 'doughnut';
  chartDataSpecId: string;
  xAxis?: ChartAxisSpec;
  yAxis?: ChartAxisSpec;
  series?: string[];
}

export interface SourceHoverTarget {
  text: string;
  metricId: string;
}

export interface SlideContent {
  title?: string;
  subtitle?: string;
  claimIds?: string[];
  chart?: ChartSpec;
  body?: string;
  sourceHoverTargets?: SourceHoverTarget[];
}

export interface SlideSpec {
  slideIndex: number;
  layout: 'cover' | 'toc' | 'section' | 'chart' | 'table' | 'text' | 'conclusion';
  masterId: string;
  content: SlideContent;
}

export interface SlideDeckSpec {
  specId: string;
  jobId: string;
  packetId: string;
  slides: SlideSpec[];
  version: number;
  status: 'draft' | 'validated' | 'approved';
}

// ─── ChartDataSpec ───────────────────────────────────────────
export interface ChartDataSeries {
  name: string;
  values: number[];
}

export interface ChartDataSpec {
  chartDataSpecId: string;
  chartType: string;
  categories: string[];
  series: ChartDataSeries[];
  metricIds: string[];
}

// ─── WorkbookProfile ─────────────────────────────────────────
export interface SheetProfile {
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
  columns: string[];
  mergedCells: string[];
  dataQuality: {
    nullCount: number;
    formatIssues: string[];
  };
}

export interface WorkbookProfile {
  profileId: string;
  jobId: string;
  sourceFileUri: string;
  sourceFileHash: string;
  sheets: SheetProfile[];
  detectedPeriods: string[];
  detectedEntities: string[];
  detectedUnits: Record<string, string>;
}

// ─── Finding (Validation) ────────────────────────────────────
export interface Finding {
  findingId: string;
  errorType: string;
  severity: FindingSeverity;
  stage: string;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  suggestedAction?: string;
}

// ─── Job ─────────────────────────────────────────────────────
export interface ArtifactManifest {
  pptxUri?: string;
  xlsxUri?: string;
  htmlPreviewUri?: string;
}

export interface Job {
  jobId: string;
  tenantId: string;
  status: JobStatus;
  currentStage: string;
  inputS3Uri: string;
  userRequest: string;
  createdAt: string;
  updatedAt: string;
  artifactManifest?: ArtifactManifest | null;
  error?: Record<string, unknown> | null;
}
