import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex digest');
const safeIdentifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/#=@+-]*$/);
const safeFileName = z.string().min(1).max(160).refine(
  value => !value.includes('/') && !value.includes('\\') && !/\p{C}/u.test(value),
  'File name must not contain paths or control characters',
);

export const ExecutionMode = ['workshop-cloud', 'internal-local'] as const;
export const executionModeSchema = z.enum(ExecutionMode);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const UploadPermissionState = ['approved', 'revoked'] as const;
export const uploadPermissionStateSchema = z.enum(UploadPermissionState);
export type UploadPermissionState = z.infer<typeof uploadPermissionStateSchema>;

export const uploadPermissionRecordSchema = z.object({
  permissionId: uuid,
  submitterSubject: safeIdentifier,
  ownerSubject: safeIdentifier,
  executionMode: z.literal('workshop-cloud'),
  acknowledgement: z.literal(true),
  datasetPurpose: z.enum(['competition-demo', 'workshop-evaluation', 'approved-prototype']),
  classification: z.literal('workshop-approved'),
  organiserApprovalReference: safeIdentifier,
  state: uploadPermissionStateSchema,
  validFrom: isoDateTime,
  validUntil: isoDateTime,
  revokedAt: isoDateTime.nullable().optional(),
  createdAt: isoDateTime,
}).strict().superRefine((record, context) => {
  const validFrom = Date.parse(record.validFrom);
  const validUntil = Date.parse(record.validUntil);
  const createdAt = Date.parse(record.createdAt);

  if (validUntil <= validFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'validUntil must be after validFrom' });
  }
  if (createdAt > validUntil) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdAt'], message: 'createdAt must not be after validUntil' });
  }
  if (record.state === 'revoked' && !record.revokedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['revokedAt'], message: 'revokedAt is required when revoked' });
  }
  if (record.state === 'approved' && record.revokedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['revokedAt'], message: 'approved records cannot have revokedAt' });
  }
});
export type UploadPermissionRecord = z.infer<typeof uploadPermissionRecordSchema>;

export const FileKind = ['source', 'template'] as const;
export const fileKindSchema = z.enum(FileKind);
export type FileKind = z.infer<typeof fileKindSchema>;

export const fileManifestSchema = z.object({
  manifestId: uuid,
  jobId: uuid,
  kind: fileKindSchema,
  fileName: safeFileName,
  extension: z.enum(['xlsx', 'csv', 'pptx']),
  contentType: z.enum([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  sha256,
  uploaderSubject: safeIdentifier,
  ownerSubject: safeIdentifier,
  objectKey: z.string().min(1).max(512),
  s3VersionId: safeIdentifier,
  activeContentDetected: z.boolean(),
  encrypted: z.boolean(),
  structurallyValid: z.boolean(),
  createdAt: isoDateTime,
}).strict().superRefine((manifest, context) => {
  const expectedExtension = manifest.kind === 'template' ? 'pptx' : undefined;
  if (expectedExtension && manifest.extension !== expectedExtension) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extension'], message: 'Template must be a pptx file' });
  }
  if (manifest.kind === 'source' && manifest.extension === 'pptx') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extension'], message: 'Source must be xlsx or csv' });
  }

  const expectedContentType: Record<typeof manifest.extension, typeof manifest.contentType> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  if (manifest.contentType !== expectedContentType[manifest.extension]) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['contentType'], message: 'Content type does not match extension' });
  }
  if (manifest.uploaderSubject !== manifest.ownerSubject) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerSubject'], message: 'Uploader must own the initial job' });
  }
  const expectedPrefix = `jobs/${manifest.jobId}/${manifest.kind}/`;
  if (!manifest.objectKey.startsWith(expectedPrefix)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['objectKey'], message: 'Object key is outside the job/kind prefix' });
  }
});
export type FileManifest = z.infer<typeof fileManifestSchema>;

export const promptContractSchema = z.object({
  promptContractId: uuid,
  jobId: uuid,
  version: z.number().int().positive(),
  audience: z.enum(['executive', 'finance', 'risk', 'general']),
  objective: z.enum(['performance-review', 'risk-review', 'competition-demo']),
  language: z.enum(['zh-TW', 'en']),
  pageBudget: z.number().int().min(3).max(30),
  requestedMetrics: z.array(safeIdentifier).min(1).max(50),
  styleConstraints: z.array(z.enum(['formal', 'concise', 'data-first', 'brand-template'])).max(4),
  templateManifestId: uuid.nullable(),
  createdAt: isoDateTime,
}).strict();
export type PromptContract = z.infer<typeof promptContractSchema>;

export const WorkflowStage = [
  'permission-intake',
  'parse-normalize',
  'formula-plan',
  'formula-approval',
  'compute-freeze',
  'insight',
  'blueprint',
  'render-inspect',
  'final-approval',
  'publish',
  'completed',
] as const;
export const workflowStageSchema = z.enum(WorkflowStage);
export type WorkflowStage = z.infer<typeof workflowStageSchema>;

export const workflowContextSchema = z.object({
  contextId: uuid,
  jobId: uuid,
  version: z.number().int().nonnegative(),
  currentStage: workflowStageSchema,
  status: z.enum(['ready', 'running', 'awaiting-user', 'gated', 'blocked', 'completed']),
  permissionId: uuid,
  promptContractId: uuid,
  inputManifestIds: z.array(uuid).min(1).max(2),
  evidenceVersion: z.number().int().nonnegative(),
  artifactVersion: z.number().int().nonnegative(),
  previousContextSha256: sha256.nullable(),
  idempotencyKey: safeIdentifier,
  createdAt: isoDateTime,
}).strict().superRefine((context, refinement) => {
  if (context.version === 0 && context.previousContextSha256 !== null) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['previousContextSha256'], message: 'Initial context cannot have a predecessor' });
  }
  if (context.version > 0 && context.previousContextSha256 === null) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['previousContextSha256'], message: 'Versioned context requires predecessor digest' });
  }
  if (context.currentStage === 'completed' && context.status !== 'completed') {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Completed stage requires completed status' });
  }
});
export type WorkflowContext = z.infer<typeof workflowContextSchema>;

const objectReferenceSchema = z.object({
  bucketRole: z.enum(['input', 'evidence', 'artifact', 'audit']),
  objectKey: z.string().min(1).max(512),
  versionId: safeIdentifier,
  sha256,
}).strict();

export const toolReceiptSchema = z.object({
  receiptId: uuid,
  jobId: uuid,
  stage: workflowStageSchema,
  toolName: safeIdentifier,
  toolVersion: safeIdentifier,
  attempt: z.number().int().positive().max(3),
  status: z.enum(['succeeded', 'failed']),
  inputRefs: z.array(objectReferenceSchema).max(20),
  outputRefs: z.array(objectReferenceSchema).max(20),
  startedAt: isoDateTime,
  completedAt: isoDateTime,
  safeErrorCode: safeIdentifier.nullable(),
}).strict().superRefine((receipt, context) => {
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'completedAt must not precede startedAt' });
  }
  if (receipt.status === 'succeeded' && receipt.safeErrorCode !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['safeErrorCode'], message: 'Successful receipt cannot include an error' });
  }
  if (receipt.status === 'failed' && receipt.safeErrorCode === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['safeErrorCode'], message: 'Failed receipt requires a safe error code' });
  }
});
export type ToolReceipt = z.infer<typeof toolReceiptSchema>;

export const stageManifestSchema = z.object({
  manifestId: uuid,
  jobId: uuid,
  stage: workflowStageSchema,
  attempt: z.number().int().positive().max(3),
  contextVersionBefore: z.number().int().nonnegative(),
  contextVersionAfter: z.number().int().positive(),
  toolReceiptIds: z.array(uuid).min(1).max(50),
  proposedTransition: workflowStageSchema,
  canonicalSha256: sha256,
  createdAt: isoDateTime,
}).strict().superRefine((manifest, context) => {
  if (manifest.contextVersionAfter !== manifest.contextVersionBefore + 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['contextVersionAfter'], message: 'Context version must increment exactly once' });
  }
});
export type StageManifest = z.infer<typeof stageManifestSchema>;

export const StageGateOutcome = ['PASS', 'REPAIRABLE_FAIL', 'BLOCKED', 'NEEDS_USER_DECISION'] as const;
export const stageGateOutcomeSchema = z.enum(StageGateOutcome);
export type StageGateOutcome = z.infer<typeof stageGateOutcomeSchema>;

const gateFindingSchema = z.object({
  code: safeIdentifier,
  severity: z.enum(['blocking', 'warning', 'info']),
  evidenceRefIds: z.array(safeIdentifier).max(20),
}).strict();

export const stageGateResultSchema = z.object({
  gateResultId: uuid,
  manifestId: uuid,
  jobId: uuid,
  stage: workflowStageSchema,
  outcome: stageGateOutcomeSchema,
  verifiedContextVersion: z.number().int().nonnegative(),
  proposedTransition: workflowStageSchema,
  findings: z.array(gateFindingSchema).max(100),
  signedAt: isoDateTime,
  signature: z.object({
    keyId: safeIdentifier,
    algorithm: z.literal('RSASSA_PSS_SHA_256'),
    payloadSha256: sha256,
    valueBase64: z.string().min(32).max(4096).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }).strict(),
}).strict().superRefine((result, context) => {
  const hasBlockingFinding = result.findings.some(finding => finding.severity === 'blocking');
  if (result.outcome === 'PASS' && hasBlockingFinding) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['findings'], message: 'PASS cannot contain blocking findings' });
  }
});
export type StageGateResult = z.infer<typeof stageGateResultSchema>;

export const callbackMetadataSchema = z.object({
  callbackId: uuid,
  jobId: uuid,
  type: z.enum(['formula-approval', 'final-approval']),
  ownerSubject: safeIdentifier,
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'consumed']),
  encryptedTokenReference: safeIdentifier,
  expiresAt: isoDateTime,
  decidedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
}).strict();
export type CallbackMetadata = z.infer<typeof callbackMetadataSchema>;

export const safeErrorSchema = z.object({
  code: safeIdentifier,
  category: z.enum(['validation', 'permission', 'dependency', 'timeout', 'throttle', 'internal']),
  retryable: z.boolean(),
  userMessageKey: safeIdentifier,
  correlationId: safeIdentifier,
}).strict();
export type SafeError = z.infer<typeof safeErrorSchema>;

const safeMetadataValueSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const prohibitedContentFieldPattern = /(workbook|cell|prompt|presigned|callbacktoken|rawcontent|artifactcontent|completion)/i;

export const safeLogEventSchema = z.object({
  eventType: safeIdentifier,
  jobId: uuid.nullable(),
  stage: workflowStageSchema.nullable(),
  status: safeIdentifier,
  correlationId: safeIdentifier,
  occurredAt: isoDateTime,
  metadata: z.record(safeMetadataValueSchema).refine(
    metadata => Object.keys(metadata).every(key => !prohibitedContentFieldPattern.test(key)),
    'Metadata contains a prohibited content-bearing field',
  ),
}).strict();
export type SafeLogEvent = z.infer<typeof safeLogEventSchema>;

export const stageCommandSchema = z.object({
  commandId: uuid,
  jobId: uuid,
  stage: workflowStageSchema,
  attempt: z.number().int().positive().max(3),
  expectedContextVersion: z.number().int().nonnegative(),
  idempotencyKey: safeIdentifier,
  issuedAt: isoDateTime,
}).strict();
export type StageCommand = z.infer<typeof stageCommandSchema>;

export const transitionRequestSchema = z.object({
  requestId: uuid,
  jobId: uuid,
  manifestId: uuid,
  gateResultId: uuid,
  currentStage: workflowStageSchema,
  proposedTransition: workflowStageSchema,
  expectedContextVersion: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(3),
  idempotencyKey: safeIdentifier,
}).strict();
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;
