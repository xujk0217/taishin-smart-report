import {
  FileManifest,
  fileManifestSchema,
  StageGateOutcome,
  UploadPermissionRecord,
  uploadPermissionRecordSchema,
  WorkflowStage,
} from './workshop-orchestration.js';

export const UploadPermissionDecisionCode = [
  'APPROVED',
  'INTERNAL_LOCAL_ONLY',
  'MISSING_PERMISSION_RECORD',
  'INVALID_PERMISSION_RECORD',
  'ACKNOWLEDGEMENT_REQUIRED',
  'CLASSIFICATION_NOT_APPROVED',
  'ORGANISER_REFERENCE_REQUIRED',
  'OWNER_MISMATCH',
  'NOT_YET_VALID',
  'EXPIRED',
  'REVOKED',
] as const;
export type UploadPermissionDecisionCode = (typeof UploadPermissionDecisionCode)[number];

export interface UploadPermissionDecision {
  readonly allowed: boolean;
  readonly code: UploadPermissionDecisionCode;
  readonly fallbackMode: 'internal-local' | null;
  readonly record: UploadPermissionRecord | null;
}

function blocked(code: UploadPermissionDecisionCode): UploadPermissionDecision {
  return { allowed: false, code, fallbackMode: 'internal-local', record: null };
}

export function evaluateUploadPermission(
  executionMode: 'workshop-cloud' | 'internal-local',
  permissionRecord: unknown,
  expectedOwnerSubject: string,
  now: Date,
): UploadPermissionDecision {
  if (executionMode === 'internal-local') {
    return blocked('INTERNAL_LOCAL_ONLY');
  }
  if (permissionRecord === null || permissionRecord === undefined) {
    return blocked('MISSING_PERMISSION_RECORD');
  }
  if (typeof permissionRecord !== 'object') {
    return blocked('INVALID_PERMISSION_RECORD');
  }

  const candidate = permissionRecord as Record<string, unknown>;
  if (candidate.acknowledgement !== true) {
    return blocked('ACKNOWLEDGEMENT_REQUIRED');
  }
  if (candidate.classification !== 'workshop-approved') {
    return blocked('CLASSIFICATION_NOT_APPROVED');
  }
  if (typeof candidate.organiserApprovalReference !== 'string' || candidate.organiserApprovalReference.length === 0) {
    return blocked('ORGANISER_REFERENCE_REQUIRED');
  }
  if (candidate.ownerSubject !== expectedOwnerSubject || candidate.submitterSubject !== expectedOwnerSubject) {
    return blocked('OWNER_MISMATCH');
  }
  if (candidate.state === 'revoked') {
    return blocked('REVOKED');
  }

  const parsed = uploadPermissionRecordSchema.safeParse(permissionRecord);
  if (!parsed.success) {
    return blocked('INVALID_PERMISSION_RECORD');
  }

  const nowMs = now.getTime();
  if (nowMs < Date.parse(parsed.data.validFrom)) {
    return blocked('NOT_YET_VALID');
  }
  if (nowMs >= Date.parse(parsed.data.validUntil)) {
    return blocked('EXPIRED');
  }

  return {
    allowed: true,
    code: 'APPROVED',
    fallbackMode: null,
    record: parsed.data,
  };
}

export const ManifestDecisionCode = [
  'SAFE',
  'INVALID_MANIFEST',
  'OWNER_MISMATCH',
  'ACTIVE_CONTENT_BLOCKED',
  'ENCRYPTED_CONTENT_BLOCKED',
  'STRUCTURAL_VALIDATION_FAILED',
] as const;
export type ManifestDecisionCode = (typeof ManifestDecisionCode)[number];

export interface ManifestDecision {
  readonly allowed: boolean;
  readonly code: ManifestDecisionCode;
  readonly manifest: FileManifest | null;
}

export function evaluateFileManifest(manifest: unknown, expectedOwnerSubject: string): ManifestDecision {
  const parsed = fileManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return { allowed: false, code: 'INVALID_MANIFEST', manifest: null };
  }
  if (parsed.data.ownerSubject !== expectedOwnerSubject || parsed.data.uploaderSubject !== expectedOwnerSubject) {
    return { allowed: false, code: 'OWNER_MISMATCH', manifest: null };
  }
  if (parsed.data.activeContentDetected) {
    return { allowed: false, code: 'ACTIVE_CONTENT_BLOCKED', manifest: null };
  }
  if (parsed.data.encrypted) {
    return { allowed: false, code: 'ENCRYPTED_CONTENT_BLOCKED', manifest: null };
  }
  if (!parsed.data.structurallyValid) {
    return { allowed: false, code: 'STRUCTURAL_VALIDATION_FAILED', manifest: null };
  }
  return { allowed: true, code: 'SAFE', manifest: parsed.data };
}

const nextStage: Readonly<Partial<Record<WorkflowStage, WorkflowStage>>> = {
  'permission-intake': 'parse-normalize',
  'parse-normalize': 'formula-plan',
  'formula-plan': 'formula-approval',
  'formula-approval': 'compute-freeze',
  'compute-freeze': 'insight',
  insight: 'blueprint',
  blueprint: 'render-inspect',
  'render-inspect': 'final-approval',
  'final-approval': 'publish',
  publish: 'completed',
};

export interface TransitionDecision {
  readonly allowed: boolean;
  readonly code:
    | 'ADVANCE'
    | 'RETRY_CURRENT_STAGE'
    | 'AWAIT_USER_DECISION'
    | 'BLOCKED'
    | 'ILLEGAL_TRANSITION'
    | 'RETRY_LIMIT_EXCEEDED';
  readonly targetStage: WorkflowStage | null;
}

export function evaluateStageTransition(
  currentStage: WorkflowStage,
  proposedTransition: WorkflowStage,
  outcome: StageGateOutcome,
  attempt: number,
  maximumAttempts = 3,
): TransitionDecision {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    return { allowed: false, code: 'ILLEGAL_TRANSITION', targetStage: null };
  }

  if (outcome === 'BLOCKED') {
    return { allowed: false, code: 'BLOCKED', targetStage: null };
  }
  if (outcome === 'NEEDS_USER_DECISION') {
    const expectedApprovalStage = currentStage === 'formula-plan'
      ? 'formula-approval'
      : currentStage === 'render-inspect'
        ? 'final-approval'
        : null;
    if (expectedApprovalStage !== proposedTransition) {
      return { allowed: false, code: 'ILLEGAL_TRANSITION', targetStage: null };
    }
    return { allowed: true, code: 'AWAIT_USER_DECISION', targetStage: proposedTransition };
  }
  if (outcome === 'REPAIRABLE_FAIL') {
    if (attempt >= maximumAttempts) {
      return { allowed: false, code: 'RETRY_LIMIT_EXCEEDED', targetStage: null };
    }
    if (proposedTransition !== currentStage) {
      return { allowed: false, code: 'ILLEGAL_TRANSITION', targetStage: null };
    }
    return { allowed: true, code: 'RETRY_CURRENT_STAGE', targetStage: currentStage };
  }

  if (nextStage[currentStage] !== proposedTransition) {
    return { allowed: false, code: 'ILLEGAL_TRANSITION', targetStage: null };
  }
  return { allowed: true, code: 'ADVANCE', targetStage: proposedTransition };
}
