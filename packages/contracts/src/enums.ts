export const DataType = ['percentage', 'amount', 'count', 'rank', 'date', 'text'] as const;
export type DataType = (typeof DataType)[number];

export const MetricUnit = ['percent', 'million_twd', 'count', 'rank', 'ratio'] as const;
export type MetricUnit = (typeof MetricUnit)[number];

export const JobStatus = [
  'created',
  'processing',
  'waiting_formula_approval',
  'waiting_preview_approval',
  'completed',
  'failed',
] as const;
export type JobStatus = (typeof JobStatus)[number];

export const ClaimStatus = ['pending', 'accepted', 'rejected', 'conflict'] as const;
export type ClaimStatus = (typeof ClaimStatus)[number];

export const ClaimDirection = ['positive', 'negative', 'neutral'] as const;
export type ClaimDirection = (typeof ClaimDirection)[number];

export const ClaimMagnitude = ['high', 'moderate', 'low'] as const;
export type ClaimMagnitude = (typeof ClaimMagnitude)[number];

export const SourceRole = ['market_competition', 'business_performance', 'risk_audit'] as const;
export type SourceRole = (typeof SourceRole)[number];

export const FormulaPlanStatus = ['pending_approval', 'approved', 'rejected'] as const;
export type FormulaPlanStatus = (typeof FormulaPlanStatus)[number];

export const FindingSeverity = ['blocking', 'warning', 'info'] as const;
export type FindingSeverity = (typeof FindingSeverity)[number];
