import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateFileManifest,
  evaluateStageTransition,
  evaluateUploadPermission,
} from './workshop-policy.js';
import {
  FileManifest,
  StageGateOutcome,
  UploadPermissionRecord,
  WorkflowStage,
  callbackMetadataSchema,
  fileManifestSchema,
  promptContractSchema,
  safeLogEventSchema,
  stageCommandSchema,
  stageGateResultSchema,
  stageManifestSchema,
  toolReceiptSchema,
  transitionRequestSchema,
  uploadPermissionRecordSchema,
  workflowContextSchema,
} from './workshop-orchestration.js';

const TEST_SEED = 20260801;
const OWNER = 'user-123';
const JOB_ID = '00000000-0000-4000-8000-000000000001';
const PERMISSION_ID = '00000000-0000-4000-8000-000000000002';
const MANIFEST_ID = '00000000-0000-4000-8000-000000000003';
const PROMPT_ID = '00000000-0000-4000-8000-000000000004';
const CONTEXT_ID = '00000000-0000-4000-8000-000000000005';
const RECEIPT_ID = '00000000-0000-4000-8000-000000000006';
const GATE_RESULT_ID = '00000000-0000-4000-8000-000000000007';
const CALLBACK_ID = '00000000-0000-4000-8000-000000000008';
const REQUEST_ID = '00000000-0000-4000-8000-000000000009';
const SHA = 'a'.repeat(64);

function approvedPermission(overrides: Partial<UploadPermissionRecord> = {}): UploadPermissionRecord {
  return {
    permissionId: PERMISSION_ID,
    submitterSubject: OWNER,
    ownerSubject: OWNER,
    executionMode: 'workshop-cloud',
    acknowledgement: true,
    datasetPurpose: 'competition-demo',
    classification: 'workshop-approved',
    organiserApprovalReference: 'approval-2026-001',
    state: 'approved',
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-08-02T00:00:00Z',
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function safeManifest(overrides: Partial<FileManifest> = {}): FileManifest {
  return {
    manifestId: MANIFEST_ID,
    jobId: JOB_ID,
    kind: 'source',
    fileName: 'source.xlsx',
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 1024,
    sha256: SHA,
    uploaderSubject: OWNER,
    ownerSubject: OWNER,
    objectKey: `jobs/${JOB_ID}/source/source.xlsx`,
    s3VersionId: 'version-1',
    activeContentDetected: false,
    encrypted: false,
    structurallyValid: true,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('Workshop orchestration contracts', () => {
  it('accepts the complete strict contract set', () => {
    expect(uploadPermissionRecordSchema.parse(approvedPermission())).toBeDefined();
    expect(fileManifestSchema.parse(safeManifest())).toBeDefined();
    expect(promptContractSchema.parse({
      promptContractId: PROMPT_ID,
      jobId: JOB_ID,
      version: 1,
      audience: 'executive',
      objective: 'competition-demo',
      language: 'zh-TW',
      pageBudget: 10,
      requestedMetrics: ['revenue', 'risk-ratio'],
      styleConstraints: ['formal', 'data-first'],
      templateManifestId: null,
      createdAt: '2026-08-01T00:00:00Z',
    })).toBeDefined();
    expect(workflowContextSchema.parse({
      contextId: CONTEXT_ID,
      jobId: JOB_ID,
      version: 0,
      currentStage: 'permission-intake',
      status: 'ready',
      permissionId: PERMISSION_ID,
      promptContractId: PROMPT_ID,
      inputManifestIds: [MANIFEST_ID],
      evidenceVersion: 0,
      artifactVersion: 0,
      previousContextSha256: null,
      idempotencyKey: 'job-1-context-0',
      createdAt: '2026-08-01T00:00:00Z',
    })).toBeDefined();
    expect(toolReceiptSchema.parse({
      receiptId: RECEIPT_ID,
      jobId: JOB_ID,
      stage: 'permission-intake',
      toolName: 'intake-inspector',
      toolVersion: '1.0.0',
      attempt: 1,
      status: 'succeeded',
      inputRefs: [],
      outputRefs: [],
      startedAt: '2026-08-01T00:00:00Z',
      completedAt: '2026-08-01T00:00:01Z',
      safeErrorCode: null,
    })).toBeDefined();
    expect(stageManifestSchema.parse({
      manifestId: MANIFEST_ID,
      jobId: JOB_ID,
      stage: 'permission-intake',
      attempt: 1,
      contextVersionBefore: 0,
      contextVersionAfter: 1,
      toolReceiptIds: [RECEIPT_ID],
      proposedTransition: 'parse-normalize',
      canonicalSha256: SHA,
      createdAt: '2026-08-01T00:00:01Z',
    })).toBeDefined();
    expect(stageGateResultSchema.parse({
      gateResultId: GATE_RESULT_ID,
      manifestId: MANIFEST_ID,
      jobId: JOB_ID,
      stage: 'permission-intake',
      outcome: 'PASS',
      verifiedContextVersion: 1,
      proposedTransition: 'parse-normalize',
      findings: [],
      signedAt: '2026-08-01T00:00:02Z',
      signature: {
        keyId: 'stage-gate-key-1',
        algorithm: 'RSASSA_PSS_SHA_256',
        payloadSha256: SHA,
        valueBase64: 'A'.repeat(32),
      },
    })).toBeDefined();
    expect(callbackMetadataSchema.parse({
      callbackId: CALLBACK_ID,
      jobId: JOB_ID,
      type: 'formula-approval',
      ownerSubject: OWNER,
      status: 'pending',
      encryptedTokenReference: 'callback-token-ref-1',
      expiresAt: '2026-08-01T01:00:00Z',
      decidedAt: null,
      createdAt: '2026-08-01T00:00:00Z',
    })).toBeDefined();
    expect(stageCommandSchema.parse({
      commandId: REQUEST_ID,
      jobId: JOB_ID,
      stage: 'permission-intake',
      attempt: 1,
      expectedContextVersion: 0,
      idempotencyKey: 'command-1',
      issuedAt: '2026-08-01T00:00:00Z',
    })).toBeDefined();
    expect(transitionRequestSchema.parse({
      requestId: REQUEST_ID,
      jobId: JOB_ID,
      manifestId: MANIFEST_ID,
      gateResultId: GATE_RESULT_ID,
      currentStage: 'permission-intake',
      proposedTransition: 'parse-normalize',
      expectedContextVersion: 1,
      attempt: 1,
      idempotencyKey: 'transition-1',
    })).toBeDefined();
  });

  it('rejects unknown and content-bearing fields', () => {
    expect(uploadPermissionRecordSchema.safeParse({ ...approvedPermission(), workbookCell: 'A1' }).success).toBe(false);
    expect(safeLogEventSchema.safeParse({
      eventType: 'stage-finished',
      jobId: JOB_ID,
      stage: 'permission-intake',
      status: 'ok',
      correlationId: 'correlation-1',
      occurredAt: '2026-08-01T00:00:00Z',
      metadata: { callbackToken: 'not-allowed' },
    }).success).toBe(false);
  });

  it('rejects a PASS result with blocking findings', () => {
    const parsed = stageGateResultSchema.safeParse({
      gateResultId: GATE_RESULT_ID,
      manifestId: MANIFEST_ID,
      jobId: JOB_ID,
      stage: 'permission-intake',
      outcome: 'PASS',
      verifiedContextVersion: 1,
      proposedTransition: 'parse-normalize',
      findings: [{ code: 'permission-missing', severity: 'blocking', evidenceRefIds: [] }],
      signedAt: '2026-08-01T00:00:02Z',
      signature: {
        keyId: 'stage-gate-key-1',
        algorithm: 'RSASSA_PSS_SHA_256',
        payloadSha256: SHA,
        valueBase64: 'A'.repeat(32),
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('Workshop upload policy', () => {
  it('allows only a currently active organiser-approved record', () => {
    const decision = evaluateUploadPermission(
      'workshop-cloud',
      approvedPermission(),
      OWNER,
      new Date('2026-08-01T12:00:00Z'),
    );
    expect(decision).toMatchObject({ allowed: true, code: 'APPROVED', fallbackMode: null });
  });

  it.each([
    ['missing record', null, 'MISSING_PERMISSION_RECORD'],
    ['acknowledgement missing', approvedPermission({ acknowledgement: false as true }), 'ACKNOWLEDGEMENT_REQUIRED'],
    ['wrong classification', { ...approvedPermission(), classification: 'internal' }, 'CLASSIFICATION_NOT_APPROVED'],
    ['missing organiser reference', { ...approvedPermission(), organiserApprovalReference: '' }, 'ORGANISER_REFERENCE_REQUIRED'],
    ['revoked', approvedPermission({ state: 'revoked', revokedAt: '2026-08-01T06:00:00Z' }), 'REVOKED'],
  ])('blocks %s', (_name, permission, expectedCode) => {
    expect(evaluateUploadPermission(
      'workshop-cloud',
      permission,
      OWNER,
      new Date('2026-08-01T12:00:00Z'),
    )).toMatchObject({ allowed: false, code: expectedCode, fallbackMode: 'internal-local' });
  });

  it('blocks unsafe manifests independently of upload permission', () => {
    expect(evaluateFileManifest(safeManifest(), OWNER)).toMatchObject({ allowed: true, code: 'SAFE' });
    expect(evaluateFileManifest(safeManifest({ activeContentDetected: true }), OWNER)).toMatchObject({
      allowed: false,
      code: 'ACTIVE_CONTENT_BLOCKED',
    });
    expect(evaluateFileManifest(safeManifest({ encrypted: true }), OWNER)).toMatchObject({
      allowed: false,
      code: 'ENCRYPTED_CONTENT_BLOCKED',
    });
  });

  it('property: owner mismatch always blocks and shrinks with a recorded seed', () => {
    const ownerArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{0,15}$/);
    fc.assert(
      fc.property(ownerArbitrary, ownerArbitrary, (owner, caller) => {
        fc.pre(owner !== caller);
        const decision = evaluateUploadPermission(
          'workshop-cloud',
          approvedPermission({ ownerSubject: owner, submitterSubject: owner }),
          caller,
          new Date('2026-08-01T12:00:00Z'),
        );
        expect(decision).toMatchObject({ allowed: false, code: 'OWNER_MISMATCH' });
      }),
      { seed: TEST_SEED, numRuns: 200 },
    );
  });

  it('property: expired records never authorize upload', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 365 }), daysExpired => {
        const validUntil = new Date(Date.UTC(2026, 7, 1) - daysExpired * 86_400_000).toISOString();
        const decision = evaluateUploadPermission(
          'workshop-cloud',
          approvedPermission({
            validFrom: '2025-01-01T00:00:00.000Z',
            validUntil,
            createdAt: '2025-01-01T00:00:00.000Z',
          }),
          OWNER,
          new Date('2026-08-01T12:00:00Z'),
        );
        expect(decision).toMatchObject({ allowed: false, code: 'EXPIRED' });
      }),
      { seed: TEST_SEED, numRuns: 100 },
    );
  });
});

describe('Stage transition policy', () => {
  const expectedNext: Readonly<Partial<Record<WorkflowStage, WorkflowStage>>> = {
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

  it('allows a signed-gate PASS only for the immediate next stage', () => {
    expect(evaluateStageTransition('permission-intake', 'parse-normalize', 'PASS', 1)).toMatchObject({
      allowed: true,
      code: 'ADVANCE',
    });
    expect(evaluateStageTransition('permission-intake', 'insight', 'PASS', 1)).toMatchObject({
      allowed: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('bounds repairs and limits user decisions to approval transitions', () => {
    expect(evaluateStageTransition('parse-normalize', 'parse-normalize', 'REPAIRABLE_FAIL', 1)).toMatchObject({
      allowed: true,
      code: 'RETRY_CURRENT_STAGE',
    });
    expect(evaluateStageTransition('parse-normalize', 'parse-normalize', 'REPAIRABLE_FAIL', 3)).toMatchObject({
      allowed: false,
      code: 'RETRY_LIMIT_EXCEEDED',
    });
    expect(evaluateStageTransition('formula-plan', 'formula-approval', 'NEEDS_USER_DECISION', 1)).toMatchObject({
      allowed: true,
      code: 'AWAIT_USER_DECISION',
    });
    expect(evaluateStageTransition('parse-normalize', 'formula-approval', 'NEEDS_USER_DECISION', 1)).toMatchObject({
      allowed: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('property: PASS cannot skip or move backwards', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WorkflowStage),
        fc.constantFrom(...WorkflowStage),
        (current, proposed) => {
          const decision = evaluateStageTransition(current, proposed, 'PASS', 1);
          expect(decision.allowed).toBe(expectedNext[current] === proposed);
        },
      ),
      { seed: TEST_SEED, numRuns: 250 },
    );
  });

  it('property: BLOCKED never advances for any stage or proposal', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WorkflowStage),
        fc.constantFrom(...WorkflowStage),
        fc.constantFrom(...(['BLOCKED'] as const satisfies readonly StageGateOutcome[])),
        (current, proposed, outcome) => {
          expect(evaluateStageTransition(current, proposed, outcome, 1)).toMatchObject({
            allowed: false,
            code: 'BLOCKED',
          });
        },
      ),
      { seed: TEST_SEED, numRuns: 100 },
    );
  });
});

describe('Seeded cross-contract properties', () => {
  it('property: any unsafe manifest flag blocks processing', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (activeContent, encrypted, structurallyValid) => {
        const decision = evaluateFileManifest(safeManifest({
          activeContentDetected: activeContent,
          encrypted,
          structurallyValid,
        }), OWNER);
        expect(decision.allowed).toBe(!activeContent && !encrypted && structurallyValid);
      }),
      { seed: TEST_SEED, numRuns: 100 },
    );
  });

  it('property: prohibited safe-log metadata keys are always rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('prompt', 'rawPrompt', 'workbookCell', 'presignedUrl', 'callbackToken', 'artifactContent'),
        fc.string({ maxLength: 40 }),
        (key, value) => {
          expect(safeLogEventSchema.safeParse({
            eventType: 'property-check',
            jobId: JOB_ID,
            stage: 'permission-intake',
            status: 'blocked',
            correlationId: 'correlation-property',
            occurredAt: '2026-08-01T00:00:00Z',
            metadata: { [key]: value },
          }).success).toBe(false);
        },
      ),
      { seed: TEST_SEED, numRuns: 100 },
    );
  });

  it('property: context version chains cannot omit or invent predecessor digests', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), version => {
        expect(workflowContextSchema.safeParse({
          contextId: CONTEXT_ID,
          jobId: JOB_ID,
          version,
          currentStage: 'parse-normalize',
          status: 'ready',
          permissionId: PERMISSION_ID,
          promptContractId: PROMPT_ID,
          inputManifestIds: [MANIFEST_ID],
          evidenceVersion: 0,
          artifactVersion: 0,
          previousContextSha256: null,
          idempotencyKey: `context-${version}`,
          createdAt: '2026-08-01T00:00:00Z',
        }).success).toBe(false);
      }),
      { seed: TEST_SEED, numRuns: 100 },
    );

    expect(workflowContextSchema.safeParse({
      contextId: CONTEXT_ID,
      jobId: JOB_ID,
      version: 0,
      currentStage: 'permission-intake',
      status: 'ready',
      permissionId: PERMISSION_ID,
      promptContractId: PROMPT_ID,
      inputManifestIds: [MANIFEST_ID],
      evidenceVersion: 0,
      artifactVersion: 0,
      previousContextSha256: SHA,
      idempotencyKey: 'context-0',
      createdAt: '2026-08-01T00:00:00Z',
    }).success).toBe(false);
  });

  it('property: a signed PASS envelope cannot hide a generated blocking finding', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/), code => {
        expect(stageGateResultSchema.safeParse({
          gateResultId: GATE_RESULT_ID,
          manifestId: MANIFEST_ID,
          jobId: JOB_ID,
          stage: 'permission-intake',
          outcome: 'PASS',
          verifiedContextVersion: 1,
          proposedTransition: 'parse-normalize',
          findings: [{ code, severity: 'blocking', evidenceRefIds: [] }],
          signedAt: '2026-08-01T00:00:02Z',
          signature: {
            keyId: 'stage-gate-key-1',
            algorithm: 'RSASSA_PSS_SHA_256',
            payloadSha256: SHA,
            valueBase64: 'A'.repeat(32),
          },
        }).success).toBe(false);
      }),
      { seed: TEST_SEED, numRuns: 100 },
    );
  });
});