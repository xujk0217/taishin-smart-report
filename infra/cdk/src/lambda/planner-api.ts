import { randomUUID } from 'node:crypto';
import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { DescribeTasksCommand, ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { ListExecutionsCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  approvePlanRequestSchema,
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
const jobLifetimeSeconds = 24 * 60 * 60;

interface ApiEvent {
  httpMethod: string;
  path: string;
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: { authorizer?: { claims?: Record<string, string | undefined> } };
}

interface UploadManifest {
  uploadId: string;
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

    if (method === 'POST' && path.endsWith('/v1/plans/uploads')) return createUploads(ownerSub, event);
    if (method === 'POST' && path.endsWith('/v1/plans')) return createPlan(ownerSub, event);
    // This path is intentionally not attached to API Gateway. It is available only
    // to principals that already have direct Lambda invoke permission.
    if (method === 'GET' && path === '/internal/planner-diagnostics') return plannerDiagnostics();

    const jobId = event.pathParameters?.jobId;
    if (!jobId) throw new RequestError(404, 'NOT_FOUND');
    if (method === 'GET') return getPlan(ownerSub, jobId);
    if (method === 'POST' && path.endsWith('/revisions')) return revisePlan(ownerSub, jobId, event);
    if (method === 'PUT') return manuallyEditPlan(ownerSub, jobId, event);
    if (method === 'POST' && path.endsWith('/approve')) return approvePlan(ownerSub, jobId, event);
    throw new RequestError(404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof RequestError) return response(error.statusCode, { code: error.code });
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
    fileName: file.fileName,
    objectKey: `plans/${jobId}/inputs/${randomUUID()}.xlsx`,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    checksumBase64: Buffer.from(file.sha256, 'hex').toString('base64'),
  }));

  await ddb.send(new PutItemCommand({
    TableName: requiredEnv('PLANNER_TABLE'),
    Item: {
      jobId: { S: jobId }, ownerSub: { S: ownerSub }, status: { S: 'UPLOAD_PENDING' },
      planVersion: { N: '0' }, createdAt: { S: now.toISOString() }, updatedAt: { S: now.toISOString() },
      expiresAt: { N: String(expiresAtEpoch) }, uploadManifestJson: { S: JSON.stringify(manifest) },
    },
    ConditionExpression: 'attribute_not_exists(jobId)',
  }));

  const uploads = await Promise.all(manifest.map(async file => {
    const post = await createPresignedPost(s3, {
      Bucket: requiredEnv('PLANNER_INPUT_BUCKET'),
      Key: file.objectKey,
      Expires: uploadExpirySeconds,
      Fields: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-amz-checksum-algorithm': 'SHA256',
        'x-amz-checksum-sha256': file.checksumBase64,
        'x-amz-meta-upload-id': file.uploadId,
      },
      Conditions: [
        ['content-length-range', file.sizeBytes, file.sizeBytes],
        ['eq', '$Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['eq', '$x-amz-checksum-sha256', file.checksumBase64],
      ],
    });
    return { uploadId: file.uploadId, fileName: file.fileName, objectKey: file.objectKey, uploadUrl: post.url, fields: post.fields, expiresInSeconds: uploadExpirySeconds };
  }));

  return response(201, { jobId, status: 'UPLOAD_PENDING', uploads, expiresAt: new Date(expiresAtEpoch * 1000).toISOString() });
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

async function getPlan(ownerSub: string, jobId: string) {
  const item = await ownedItem(ownerSub, jobId);
  return response(200, publicItem(item));
}

async function revisePlan(ownerSub: string, jobId: string, event: ApiEvent) {
  const parsed = revisePlanRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_REVISION_REQUEST');
  const now = new Date().toISOString();
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :queued, revisionInstruction = :instruction, updatedAt = :updated',
      ConditionExpression: 'ownerSub = :owner AND #status = :review AND planVersion = :version',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':queued': { S: 'REVISION_QUEUED' }, ':review': { S: 'NEEDS_REVIEW' }, ':instruction': { S: parsed.data.instruction }, ':updated': { S: now }, ':owner': { S: ownerSub }, ':version': { N: String(parsed.data.expectedPlanVersion) } },
    }));
  } catch { throw new RequestError(409, 'STALE_OR_INVALID_STATE'); }
  await startPlanner(jobId, 'REVISE', parsed.data.expectedPlanVersion);
  return response(202, { jobId, status: 'REVISION_QUEUED', planVersion: parsed.data.expectedPlanVersion });
}

async function manuallyEditPlan(ownerSub: string, jobId: string, event: ApiEvent) {
  const parsed = manualPlanEditRequestSchema.safeParse(parseBody(event));
  if (!parsed.success) throw new RequestError(400, 'INVALID_MANUAL_PLAN');
  const nextVersion = parsed.data.expectedPlanVersion + 1;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: requiredEnv('PLANNER_TABLE'), Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET planningOutputJson = :output, planVersion = :next, updatedAt = :updated, editSummary = :summary',
      ConditionExpression: 'ownerSub = :owner AND #status = :review AND planVersion = :expected',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':output': { S: JSON.stringify(parsed.data.planningOutput) }, ':next': { N: String(nextVersion) }, ':expected': { N: String(parsed.data.expectedPlanVersion) },
        ':updated': { S: new Date().toISOString() }, ':summary': { S: parsed.data.editSummary ?? 'Manual schema edit' }, ':owner': { S: ownerSub }, ':review': { S: 'NEEDS_REVIEW' },
      },
    }));
  } catch { throw new RequestError(409, 'STALE_OR_INVALID_STATE'); }
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

function publicItem(item: Record<string, { S?: string; N?: string }>) {
  const expiresAt = new Date(Number(item.expiresAt.N) * 1000).toISOString();
  return {
    jobId: item.jobId.S, status: item.status.S, planVersion: Number(item.planVersion.N ?? 0),
    createdAt: item.createdAt.S, updatedAt: item.updatedAt.S, expiresAt,
    planningOutput: item.planningOutputJson?.S ? JSON.parse(item.planningOutputJson.S) : null,
    sourceReferences: item.sourceReferencesJson?.S ? JSON.parse(item.sourceReferencesJson.S) : [],
    safeErrorCode: item.safeErrorCode?.S ?? null,
  };
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
