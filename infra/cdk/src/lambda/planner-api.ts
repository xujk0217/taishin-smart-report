import { randomUUID } from 'node:crypto';
import { CloudWatchLogsClient, DescribeLogStreamsCommand, FilterLogEventsCommand, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { DescribeTasksCommand, ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { ListExecutionsCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  approvePlanRequestSchema,
  attachTemplateRequestSchema,
  createPlanRequestSchema,
  createUploadRequestSchema,
  manualPlanEditRequestSchema,
  revisePlanRequestSchema,
} from '@smart-report/contracts';

const ddb = new DynamoDBClient({});
const ecs = new ECSClient({});
const cloudWatchLogs = new CloudWatchLogsClient({});
const s3 = new S3Client({});
const sfn = new SFNClient({});
const uploadExpirySeconds = 15 * 60;
const jobLifetimeSeconds = 30 * 24 * 60 * 60;
const dynamodbItemHardLimitBytes = 400 * 1024;
const dynamodbItemSafetyMarginBytes = 40 * 1024;
const maxStoredJobItemBytes = dynamodbItemHardLimitBytes - dynamodbItemSafetyMarginBytes;
const retryablePlanningErrorCodes = new Set(['PLAN_OUTPUT_TOO_LARGE', 'PLAN_OUTPUT_STORAGE_LIMIT']);

interface ApiEvent {
  httpMethod: string;
  path: string;
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: { authorizer?: { claims?: Record<string, string | undefined> } };
}

interface UploadManifest {
  uploadId: string;
  kind: 'excel' | 'template';
  fileName: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  checksumBase64: string;
}

export async function handler(event: ApiEvent) {
  try {
    const ownerSub = event.requestContext?.authorizer?.claims?.sub;
    if (!ownerSub) throw new RequestError(401, 'AUTHENTICATION_REQUIRED');
    const method = event.httpMethod.toUpperCase();
    const path = event.path;

    if (method === 'POST' && path.endsWith('/v1/plans/uploads')) return await createUploads(ownerSub, event);
    if (method === 'POST' && path.endsWith('/v1/plans')) return await createPlan(ownerSub, event);
    if (method === 'GET' && path.endsWith('/v1/plans')) return await listPlans(ownerSub);
    // This path is intentionally not attached to API Gateway. It is available only
    // to principals that already have direct Lambda invoke permission.
    if (method === 'GET' && path === '/internal/planner-diagnostics') return await plannerDiagnostics();

    const jobId = event.pathParameters?.jobId;
    if (!jobId) throw new RequestError(404, 'NOT_FOUND');
    if (method === 'POST' && path.endsWith('/template/uploads')) return await attachTemplate(ownerSub, jobId, event);
    if (method === 'GET') return await getPlan(ownerSub, jobId);
    if (method === 'POST' && path.endsWith('/revisions')) return await revisePlan(ownerSub, jobId, event);
    if (method === 'POST' && path.endsWith('/retry')) return await retryPlanning(ownerSub, jobId);
    if (method === 'POST' && path.endsWith('/calculations')) return await retryCalculation(ownerSub, jobId);
    if (method === 'PUT') return await manuallyEditPlan(ownerSub, jobId, event);
    if (method === 'POST' && path.endsWith('/approve')) return await approvePlan(ownerSub, jobId, event);
    throw new RequestError(404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof RequestError) return response(error.statusCode, { code: error.code });
    // Preserve deliberate client-safe errors even if a bundled runtime changes
    // the Error prototype chain (the direct Lambda test path has done this).
    if (isRequestError(error)) return response(error.statusCode, { code: error.code });
    const errorMessage = error instanceof Error ? error.message : '';
    const knownCode = requestErrorStatus[errorMessage];
    if (knownCode) return response(knownCode, { code: errorMessage });
    console.error(JSON.stringify({ level: 'error', code: 'UNHANDLED_API_ERROR' }));
    return response(500, { code: 'INTERNAL_ERROR' });
  }
}

async function plannerDiagnostics() {
  const cluster = requiredEnv('PLANNER_CLUSTER_ARN');
  const logGroupName = requiredEnv('PLANNER_LOG_GROUP');
  const [running, stopped, executions, streams] = await Promise.all([
    ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'RUNNING', maxResults: 10 })),
    ecs.send(new ListTasksCommand({ cluster, desiredStatus: 'STOPPED', maxResults: 10 })),
    sfn.send(new ListExecutionsCommand({ stateMachineArn: requiredEnv('PLANNER_STATE_MACHINE_ARN'), maxResults: 10 })),
    cloudWatchLogs.send(new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: 'LastEventTime',
      descending: true,
      limit: 5,
    })),
  ]);
  const taskArns = [...(running.taskArns ?? []), ...(stopped.taskArns ?? [])];
  const described = taskArns.length > 0
    ? await ecs.send(new DescribeTasksCommand({ cluster, tasks: taskArns }))
    : { tasks: [], failures: [] };
  const recentLogs = await Promise.all((streams.logStreams ?? []).map(async stream => ({
    logStreamName: stream.logStreamName,
    events: stream.logStreamName
      ? (await cloudWatchLogs.send(new GetLogEventsCommand({
        logGroupName,
        logStreamName: stream.logStreamName,
        startFromHead: false,
        limit: 100,
      }))).events?.map(event => event.message) ?? []
      : [],
  })));
  return response(200, {
    executions: (executions.executions ?? []).map(execution => ({
      name: execution.name,
      status: execution.status,
      startDate: execution.startDate?.toISOString(),
      stopDate: execution.stopDate?.toISOString(),
    })),
    tasks: (described.tasks ?? []).map(task => ({
      taskArn: task.taskArn,
      lastStatus: task.lastStatus,
      desiredStatus: task.desiredStatus,
      stopCode: task.stopCode,
      stoppedReason: task.stoppedReason,
      containers: (task.containers ?? []).map(container => ({
        name: container.name,
        lastStatus: container.lastStatus,
        exitCode: container.exitCode,
        reason: container.reason,
      })),
    })),
    failures: described.failures ?? [],
    recentLogs,
  });
}

async function createUploads(ownerSub: string, event: ApiEvent) {
  const request = createUploadRequestSchema.safeParse(parseBody(event));
  if (!request.success) throw new RequestError(400, 'INVALID_UPLOAD_REQUEST');
  const jobId = randomUUID();
  const now = new Date();
  const expiresAtEpoch = Math.floor(now.getTime() / 1000) + jobLifetimeSeconds;
  const manifest: UploadManifest[] = request.data.files.map(file => ({
    uploadId: randomUUID(),
    kind: file.kind,
    fileName: file.fileName,
    objectKey: `plans/${jobId}/${file.kind === 'template' ? 'template' : 'inputs'}/${randomUUID()}.${file.kind === 'template' ? 'pptx' : 'xlsx'}`,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    checksumBase64: Buffer.from(file.sha256, 'hex').toString('base64'),
  }));

  const initialItem: Record<string, AttributeValue> = {
    jobId: { S: jobId }, ownerSub: { S: ownerSub }, status: { S: 'UPLOAD_PENDING' },
    planVersion: { N: '0' }, createdAt: { S: now.toISOString() }, updatedAt: { S: now.toISOString() },
    expiresAt: { N: String(expiresAtEpoch) }, uploadManifestJson: { S: JSON.stringify(manifest) },
  };
  assertStorableJobItem({}, initialItem);
  await ddb.send(new PutItemCommand({
    TableName: requiredEnv('PLANNER_TABLE'),
    Item: initialItem,
    ConditionExpression: 'attribute_not_exists(jobId)',
  }));

  const uploads = await Promise.all(manifest.map(async file => {
    const post = await createUploadPost(file);
    return { uploadId: file.uploadId, fileName: file.fileName, objectKey: file.objectKey, uploadUrl: post.url, fields: post.fields, expiresInSeconds: uploadExpirySeconds };
  }));

  return response(201, { jobId, status: 'UPLOAD_PENDING', uploads, expiresAt: new Date(expiresAtEpoch * 1000).toISOString() });
}

async function createUploadPost(file: UploadManifest) {
  return createPresignedPost(s3, {
    Bucket: requiredEnv('PLANNER_INPUT_BUCKET'), Key: file.objectKey, Expires: uploadExpirySeconds,
    Fields: {
      'Content-Type': contentType(file.kind), 'x-amz-checksum-algorithm': 'SHA256',
      'x-amz-checksum-sha256': file.checksumBase64, 'x-amz-meta-upload-id': file.uploadId,
    },
    Conditions: [
      ['content-length-range', file.sizeBytes, file.sizeBytes], ['eq', '$Content-Type', contentType(file.kind)],
      ['eq', '$x-amz-checksum-sha256', file.checksumBase64],
    ],
  });
}

async function createPlan(ownerSub: string, event: ApiEvent) {
  const parsed = createPlanRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_PLAN_REQUEST');
  const item = await ownedItem(ownerSub, parsed.data.jobId);
  if (item.status.S !== 'UPLOAD_PENDING') throw new RequestError(409, 'INVALID_STATE');
  const manifest = JSON.parse(item.uploadManifestJson.S ?? '[]') as UploadManifest[];
  for (const file of manifest) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: requiredEnv('PLANNER_INPUT_BUCKET'), Key: file.objectKey, ChecksumMode: 'ENABLED' }));
    if (head.ContentLength !== file.sizeBytes || head.ChecksumSHA256 !== file.checksumBase64 || head.Metadata?.['upload-id'] !== file.uploadId) {
      throw new RequestError(400, 'UPLOAD_VERIFICATION_FAILED');
    }
  }
  const now = new Date().toISOString();
  assertStorableJobItem(item, {
    status: { S: 'QUEUED' },
    prompt: { S: parsed.data.prompt },
    updatedAt: { S: now },
  });
  await ddb.send(new UpdateItemCommand({
    TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: parsed.data.jobId } },
    UpdateExpression: 'SET #status = :queued, prompt = :prompt, updatedAt = :updated',
    ConditionExpression: 'ownerSub = :owner AND #status = :pending',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':queued': { S: 'QUEUED' }, ':pending': { S: 'UPLOAD_PENDING' }, ':prompt': { S: parsed.data.prompt }, ':updated': { S: now }, ':owner': { S: ownerSub } },
  }));
  await startPlanner(parsed.data.jobId, 'CREATE', 0);
  return response(202, { jobId: parsed.data.jobId, status: 'QUEUED', planVersion: 0 });
}

async function attachTemplate(ownerSub: string, jobId: string, event: ApiEvent) {
  const request = attachTemplateRequestSchema.safeParse(parseBody(event));
  if (!request.success) throw new RequestError(400, 'INVALID_TEMPLATE_UPLOAD_REQUEST');
  const item = await ownedItem(ownerSub, jobId);
  const allowedStates = new Set(['NEEDS_REVIEW', 'CALCULATION_READY', 'CALCULATION_FAILED']);
  if (!allowedStates.has(item.status.S ?? '')) throw new RequestError(409, 'INVALID_STATE');
  const file = request.data.file;
  const template: UploadManifest = {
    uploadId: randomUUID(), kind: 'template', fileName: file.fileName,
    objectKey: `plans/${jobId}/template/${randomUUID()}.pptx`, sizeBytes: file.sizeBytes,
    sha256: file.sha256, checksumBase64: Buffer.from(file.sha256, 'hex').toString('base64'),
  };
  let manifest: UploadManifest[];
  try { manifest = JSON.parse(item.uploadManifestJson.S ?? '[]') as UploadManifest[]; } catch { throw new RequestError(409, 'UPLOAD_MANIFEST_UNAVAILABLE'); }
  const nextManifest = [...manifest.filter(entry => entry.kind !== 'template'), template];
  const nextManifestJson = JSON.stringify(nextManifest);
  const updatedAt = new Date().toISOString();
  assertStorableJobItem(item, {
    uploadManifestJson: { S: nextManifestJson },
    updatedAt: { S: updatedAt },
  });
  await ddb.send(new UpdateItemCommand({
    TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET uploadManifestJson = :manifest, updatedAt = :updated',
    ConditionExpression: 'ownerSub = :owner AND #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':manifest': { S: nextManifestJson }, ':updated': { S: updatedAt },
      ':owner': { S: ownerSub }, ':status': item.status,
    },
  }));
  const post = await createUploadPost(template);
  return response(201, { upload: { uploadId: template.uploadId, fileName: template.fileName, objectKey: template.objectKey, uploadUrl: post.url, fields: post.fields, expiresInSeconds: uploadExpirySeconds } });
}

async function getPlan(ownerSub: string, jobId: string) {
  const item = await ownedItem(ownerSub, jobId);
  const publicJob = publicItem(item);
  return response(200, { ...publicJob, progress: await plannerProgress(publicJob) });
}

async function listPlans(ownerSub: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: requiredEnv('PLANNER_TABLE'),
    IndexName: requiredEnv('PLANNER_OWNER_INDEX'),
    KeyConditionExpression: 'ownerSub = :owner',
    ExpressionAttributeValues: { ':owner': { S: ownerSub } },
    ScanIndexForward: false,
    Limit: 30,
  }));
  const now = Math.floor(Date.now() / 1000);
  return response(200, { projects: (result.Items ?? [])
    .filter(item => Number(item.expiresAt?.N ?? 0) > now)
    .map(projectSummary) });
}

async function revisePlan(ownerSub: string, jobId: string, event: ApiEvent) {
  const parsed = revisePlanRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_REVISION_REQUEST');
  const current = await ownedItem(ownerSub, jobId);
  const now = new Date().toISOString();
  assertStorableJobItem(current, {
    status: { S: 'REVISION_QUEUED' },
    revisionInstruction: { S: parsed.data.instruction },
    updatedAt: { S: now },
  });
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :queued, revisionInstruction = :instruction, updatedAt = :updated',
      ConditionExpression: 'ownerSub = :owner AND #status = :review AND planVersion = :version',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':queued': { S: 'REVISION_QUEUED' }, ':review': { S: 'NEEDS_REVIEW' }, ':instruction': { S: parsed.data.instruction }, ':updated': { S: now }, ':owner': { S: ownerSub }, ':version': { N: String(parsed.data.expectedPlanVersion) } },
    }));
  } catch (error) {
    if (isDynamoItemTooLarge(error)) throw new RequestError(413, 'PLAN_OUTPUT_STORAGE_LIMIT');
    throw new RequestError(409, 'STALE_OR_INVALID_STATE');
  }
  await startPlanner(jobId, 'REVISE', parsed.data.expectedPlanVersion);
  return response(202, { jobId, status: 'REVISION_QUEUED', planVersion: parsed.data.expectedPlanVersion });
}

async function manuallyEditPlan(ownerSub: string, jobId: string, event: ApiEvent) {
  const parsed = manualPlanEditRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_MANUAL_PLAN');
  const current = await ownedItem(ownerSub, jobId);
  validateManualBindings(parsed.data.planningOutput, current.workbookSchemaJson?.S);
  const nextVersion = parsed.data.expectedPlanVersion + 1;
  const outputJson = JSON.stringify(parsed.data.planningOutput);
  const updatedAt = new Date().toISOString();
  const editSummary = parsed.data.editSummary ?? 'Manual schema edit';
  const projectTitle = parsed.data.planningOutput.deck_plan.title.slice(0, 300);
  assertStorableJobItem(current, {
    planningOutputJson: { S: outputJson },
    planVersion: { N: String(nextVersion) },
    updatedAt: { S: updatedAt },
    editSummary: { S: editSummary },
    projectTitle: { S: projectTitle },
  });
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET planningOutputJson = :output, planVersion = :next, updatedAt = :updated, editSummary = :summary, projectTitle = :title',
      ConditionExpression: 'ownerSub = :owner AND #status = :review AND planVersion = :expected',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':output': { S: outputJson }, ':next': { N: String(nextVersion) }, ':expected': { N: String(parsed.data.expectedPlanVersion) },
        ':updated': { S: updatedAt }, ':summary': { S: editSummary }, ':title': { S: projectTitle }, ':owner': { S: ownerSub }, ':review': { S: 'NEEDS_REVIEW' },
      },
    }));
  } catch (error) {
    if (isDynamoItemTooLarge(error)) throw new RequestError(413, 'PLAN_OUTPUT_STORAGE_LIMIT');
    throw new RequestError(409, 'STALE_OR_INVALID_STATE');
  }
  return getPlan(ownerSub, jobId);
}

async function approvePlan(ownerSub: string, jobId: string, event: ApiEvent) {
  const parsed = approvePlanRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_APPROVAL_REQUEST');
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :approved, approvedAt = :now, updatedAt = :now',
      ConditionExpression: 'ownerSub = :owner AND #status = :review AND planVersion = :version',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':approved': { S: 'APPROVED' }, ':review': { S: 'NEEDS_REVIEW' }, ':now': { S: new Date().toISOString() }, ':owner': { S: ownerSub }, ':version': { N: String(parsed.data.expectedPlanVersion) } },
    }));
  } catch { throw new RequestError(409, 'STALE_OR_INVALID_STATE'); }
  await ddb.send(new UpdateItemCommand({
    TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET #status = :queued, updatedAt = :now',
    ConditionExpression: 'ownerSub = :owner AND #status = :approved',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':queued': { S: 'CALCULATION_QUEUED' }, ':approved': { S: 'APPROVED' }, ':now': { S: new Date().toISOString() }, ':owner': { S: ownerSub } },
  }));
  await startPlanner(jobId, 'CALCULATE', parsed.data.expectedPlanVersion);
  return getPlan(ownerSub, jobId);
}

async function retryPlanning(ownerSub: string, jobId: string) {
  const item = await ownedItem(ownerSub, jobId);
  const safeErrorCode = item.safeErrorCode?.S ?? '';
  if (item.status?.S !== 'FAILED' || !retryablePlanningErrorCodes.has(safeErrorCode)) {
    throw new RequestError(409, 'STALE_OR_INVALID_STATE');
  }
  const operation = item.revisionInstruction?.S ? 'REVISE' : 'CREATE';
  const queuedStatus = operation === 'REVISE' ? 'REVISION_QUEUED' : 'QUEUED';
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :queued, updatedAt = :now REMOVE safeErrorCode',
      ConditionExpression: 'ownerSub = :owner AND #status = :failed AND safeErrorCode = :code',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':queued': { S: queuedStatus }, ':failed': { S: 'FAILED' }, ':code': { S: safeErrorCode },
        ':now': { S: new Date().toISOString() }, ':owner': { S: ownerSub },
      },
    }));
  } catch { throw new RequestError(409, 'STALE_OR_INVALID_STATE'); }
  await startPlanner(jobId, operation, Number(item.planVersion?.N ?? 0));
  return getPlan(ownerSub, jobId);
}

async function retryCalculation(ownerSub: string, jobId: string) {
  const item = await ownedItem(ownerSub, jobId);
  const safeErrorCode = item.safeErrorCode?.S ?? '';
  const previousError = item.calculationRetryContext?.S ?? safeErrorCode;
  if (item.status?.S !== 'CALCULATION_FAILED' || !safeErrorCode || !previousError || !item.planningOutputJson?.S) {
    throw new RequestError(409, 'STALE_OR_INVALID_STATE');
  }
  const retryContext = previousError.slice(0, 240);
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :queued, calculationRetryContext = :retryContext, updatedAt = :now REMOVE safeErrorCode',
      ConditionExpression: 'ownerSub = :owner AND #status = :failed AND safeErrorCode = :code AND attribute_exists(planningOutputJson)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':queued': { S: 'CALCULATION_QUEUED' }, ':failed': { S: 'CALCULATION_FAILED' },
        ':code': { S: safeErrorCode }, ':retryContext': { S: retryContext },
        ':now': { S: new Date().toISOString() }, ':owner': { S: ownerSub },
      },
    }));
  } catch { throw new RequestError(409, 'STALE_OR_INVALID_STATE'); }
  try {
    await startPlanner(jobId, 'CALCULATE', Number(item.planVersion?.N ?? 0));
  } catch {
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
        UpdateExpression: 'SET #status = :failed, safeErrorCode = :code, updatedAt = :now',
        ConditionExpression: 'ownerSub = :owner AND #status = :queued AND calculationRetryContext = :retryContext',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': { S: 'CALCULATION_FAILED' }, ':queued': { S: 'CALCULATION_QUEUED' },
          ':code': { S: safeErrorCode }, ':retryContext': { S: retryContext },
          ':now': { S: new Date().toISOString() }, ':owner': { S: ownerSub },
        },
      }));
    } catch {
      console.error(JSON.stringify({ level: 'error', code: 'CALCULATION_RETRY_ROLLBACK_FAILED', jobId }));
    }
    throw new RequestError(503, 'CALCULATION_RETRY_START_FAILED');
  }
  return getPlan(ownerSub, jobId);
}

async function ownedItem(ownerSub: string, jobId: string) {
  const result = await ddb.send(new GetItemCommand({ TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } }, ConsistentRead: true }));
  const item = result.Item;
  if (!item || item.ownerSub?.S !== ownerSub) throw new RequestError(404, 'NOT_FOUND');
  if (Number(item.expiresAt?.N ?? 0) <= Math.floor(Date.now() / 1000)) throw new RequestError(410, 'EXPIRED');
  return item;
}

async function startPlanner(jobId: string, operation: string, version: number) {
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: requiredEnv('PLANNER_STATE_MACHINE_ARN'),
    name: `${jobId}-${version}-${Date.now()}`.slice(0, 80),
    input: JSON.stringify({ jobId, operation }),
  }));
}

type PublicPlannerJob = ReturnType<typeof publicItem>;

function publicItem(item: Record<string, { S?: string; N?: string }>) {
  const expiresAt = new Date(Number(item.expiresAt.N) * 1000).toISOString();
  return {
    jobId: item.jobId.S, status: item.status.S, planVersion: Number(item.planVersion.N ?? 0),
    createdAt: item.createdAt.S, updatedAt: item.updatedAt.S, expiresAt,
    prompt: item.prompt?.S ?? null,
    fileNames: fileNames(item),
    templateFileName: templateFileName(item),
    planningOutput: item.planningOutputJson?.S ? JSON.parse(item.planningOutputJson.S) : null,
    sourceReferences: item.sourceReferencesJson?.S ? JSON.parse(item.sourceReferencesJson.S) : [],
    workbookSchema: item.workbookSchemaJson?.S ? JSON.parse(item.workbookSchemaJson.S) : [],
    safeErrorCode: item.safeErrorCode?.S ?? null,
    promptAlignmentScore: item.promptAlignmentScore?.N ? Number(item.promptAlignmentScore.N) : null,
    calculationSummary: item.calculationSummaryJson?.S ? JSON.parse(item.calculationSummaryJson.S) : null,
  };
}

function validateManualBindings(planningOutput: { calculation_plan: { tasks: Array<{ input_bindings: Array<{ workbook_upload_id: string; workbook_selector: string; sheet_selector: string; column_selector: string }> }> } }, schemaJson: string | undefined) {
  if (!schemaJson) return; // Jobs created before the selector catalog remain editable through existing validation.
  let catalog: Array<{ uploadId: string; fileName: string; sheets: Array<{ sheetName: string; columns: string[] }> }>;
  try { catalog = JSON.parse(schemaJson); } catch { throw new RequestError(409, 'WORKBOOK_SCHEMA_UNAVAILABLE'); }
  for (const task of planningOutput.calculation_plan.tasks) {
    for (const binding of task.input_bindings) {
      const workbook = catalog.find(item => item.uploadId === binding.workbook_upload_id && item.fileName === binding.workbook_selector);
      const sheet = workbook?.sheets.find(item => item.sheetName === binding.sheet_selector);
      if (!sheet?.columns.includes(binding.column_selector)) throw new RequestError(400, 'INVALID_WORKBOOK_BINDING');
    }
  }
}

function fileNames(item: Record<string, { S?: string; N?: string }>) {
  try {
    return (JSON.parse(item.uploadManifestJson?.S ?? '[]') as UploadManifest[]).filter(file => file.kind !== 'template').map(file => file.fileName);
  } catch {
    return [];
  }
}

function templateFileName(item: Record<string, { S?: string; N?: string }>) {
  try {
    return (JSON.parse(item.uploadManifestJson?.S ?? '[]') as UploadManifest[]).find(file => file.kind === 'template')?.fileName ?? null;
  } catch {
    return null;
  }
}

function contentType(kind: UploadManifest['kind']) {
  return kind === 'template'
    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function projectSummary(item: Record<string, { S?: string; N?: string }>) {
  const prompt = item.prompt?.S?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    jobId: item.jobId.S, status: item.status.S, planVersion: Number(item.planVersion.N ?? 0),
    createdAt: item.createdAt.S, updatedAt: item.updatedAt.S,
    expiresAt: new Date(Number(item.expiresAt.N) * 1000).toISOString(),
    title: item.projectTitle?.S ?? null,
    promptPreview: prompt.slice(0, 240),
    fileNames: fileNames(item),
    templateFileName: templateFileName(item),
    hasPlanningOutput: Boolean(item.planningOutputJson?.S),
    safeErrorCode: item.safeErrorCode?.S ?? null,
    promptAlignmentScore: item.promptAlignmentScore?.N ? Number(item.promptAlignmentScore.N) : null,
    calculationSummary: item.calculationSummaryJson?.S ? JSON.parse(item.calculationSummaryJson.S) : null,
  };
}

const activePlannerStatuses = new Set(['QUEUED', 'RUNNING', 'REVISION_QUEUED', 'CALCULATION_QUEUED', 'CALCULATING']);
const progressStages = new Set(['requirements', 'formula', 'calculation', 'composition', 'prompt-alignment', 'calculation-code', 'calculation-execution']);

async function plannerProgress(job: PublicPlannerJob) {
  if (!activePlannerStatuses.has(job.status ?? '')) return null;
  try {
    const result = await cloudWatchLogs.send(new FilterLogEventsCommand({
      logGroupName: requiredEnv('PLANNER_LOG_GROUP'),
      // jobId is UUID-generated by this service, and each worker event includes it.
      filterPattern: `{ $.jobId = "${job.jobId}" }`,
      startTime: job.updatedAt ? Date.parse(job.updatedAt) : undefined,
      interleaved: true,
      limit: 50,
    }));
    let latest: { currentStage: string | null; state: string; attempt: number | null; updatedAt: string | null } = {
      currentStage: null, state: 'waiting', attempt: null, updatedAt: null,
    };
    for (const event of result.events ?? []) {
      if (!event.message || !event.timestamp) continue;
      try {
        const entry = JSON.parse(event.message) as Record<string, unknown>;
        if (entry.jobId !== job.jobId || typeof entry.stage !== 'string' || !progressStages.has(entry.stage)) continue;
        const status = entry.status;
        latest = {
          currentStage: entry.stage,
          state: status === 'started' ? 'started' : status === 'completed' ? 'completed' : entry.level === 'error' ? 'failed' : entry.level === 'warning' ? 'retrying' : 'waiting',
          attempt: typeof entry.attempt === 'number' ? entry.attempt : typeof entry.validation_attempt === 'number' ? entry.validation_attempt : null,
          updatedAt: new Date(event.timestamp).toISOString(),
        };
      } catch { /* Skip non-JSON container output. */ }
    }
    return latest;
  } catch (error) {
    // Monitoring must never make the owner-facing job endpoint unavailable.
    console.warn(JSON.stringify({ level: 'warning', code: 'PLANNER_PROGRESS_UNAVAILABLE', jobId: job.jobId }));
    return { currentStage: null, state: 'waiting', attempt: null, updatedAt: null };
  }
}

function attributeValueSizeBytes(value: AttributeValue): number {
  if ('S' in value) return Buffer.byteLength(value.S ?? '', 'utf8');
  if ('N' in value) return Buffer.byteLength(value.N ?? '', 'utf8');
  if ('B' in value) return value.B?.byteLength ?? 0;
  if ('BOOL' in value || 'NULL' in value) return 1;
  if ('SS' in value) return 3 + (value.SS ?? []).reduce((sum, item) => sum + Buffer.byteLength(item, 'utf8') + 3, 0);
  if ('NS' in value) return 3 + (value.NS ?? []).reduce((sum, item) => sum + Buffer.byteLength(item, 'utf8') + 3, 0);
  if ('BS' in value) return 3 + (value.BS ?? []).reduce((sum, item) => sum + item.byteLength + 3, 0);
  if ('L' in value) return 3 + (value.L ?? []).reduce((sum, item) => sum + attributeValueSizeBytes(item) + 3, 0);
  if ('M' in value) return 3 + Object.entries(value.M ?? {}).reduce(
    (sum, [name, item]) => sum + Buffer.byteLength(name, 'utf8') + attributeValueSizeBytes(item) + 3,
    0,
  );
  return 1;
}

function assertStorableJobItem(
  item: Record<string, AttributeValue>,
  updates: Record<string, AttributeValue>,
  removals: string[] = [],
) {
  const candidate = { ...item, ...updates };
  for (const name of removals) delete candidate[name];
  const estimatedBytes = 100 + Object.entries(candidate).reduce(
    (sum, [name, value]) => sum + Buffer.byteLength(name, 'utf8') + attributeValueSizeBytes(value) + 3,
    0,
  );
  if (estimatedBytes > maxStoredJobItemBytes) throw new RequestError(413, 'PLAN_OUTPUT_STORAGE_LIMIT');
}

function isDynamoItemTooLarge(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; message?: unknown };
  return candidate.name === 'ValidationException'
    && typeof candidate.message === 'string'
    && /item size|maximum allowed size/i.test(candidate.message);
}

function parseBody(event: ApiEvent): unknown {
  if (!event.body) throw new RequestError(400, 'BODY_REQUIRED');
  try { return JSON.parse(event.body); } catch { throw new RequestError(400, 'INVALID_JSON'); }
}

function response(statusCode: number, body: object) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': requiredEnv('UI_ORIGIN'), vary: 'Origin' }, body: JSON.stringify(body) };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}

const requestErrorStatus: Record<string, number> = {
  AUTHENTICATION_REQUIRED: 401,
  NOT_FOUND: 404,
  EXPIRED: 410,
  BODY_REQUIRED: 400,
  INVALID_JSON: 400,
  INVALID_UPLOAD_REQUEST: 400,
  INVALID_PLAN_REQUEST: 400,
  INVALID_REVISION_REQUEST: 400,
  INVALID_MANUAL_PLAN: 400,
  INVALID_WORKBOOK_BINDING: 400,
  WORKBOOK_SCHEMA_UNAVAILABLE: 409,
  INVALID_APPROVAL_REQUEST: 400,
  UPLOAD_VERIFICATION_FAILED: 400,
  INVALID_STATE: 409,
  STALE_OR_INVALID_STATE: 409,
  PLAN_OUTPUT_STORAGE_LIMIT: 413,
};

function isRequestError(error: unknown): error is { statusCode: number; code: string } {
  return typeof error === 'object' && error !== null
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
    && typeof (error as { code?: unknown }).code === 'string';
}
