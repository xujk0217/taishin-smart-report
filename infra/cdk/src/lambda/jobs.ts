import { randomUUID } from 'node:crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const UPLOAD_TTL_SECONDS = 15 * 60;
const ALLOWED_UPLOADERS_GROUP = 'workshop-uploaders';

interface RequestedUpload {
  readonly kind: 'source' | 'template';
  readonly fileName: string;
  readonly contentType: string;
}

interface ApiEvent {
  readonly body?: string | null;
  readonly requestContext?: {
    readonly authorizer?: {
      readonly claims?: Record<string, string | undefined>;
    };
  };
}

const allowedTypes: Record<RequestedUpload['kind'], ReadonlySet<string>> = {
  source: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ]),
  template: new Set([
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
};

export async function handler(event: ApiEvent) {
  const subject = event.requestContext?.authorizer?.claims?.sub;
  const groups = event.requestContext?.authorizer?.claims?.['cognito:groups'] ?? '';
  if (!subject || !groups.split(',').map(group => group.trim()).includes(ALLOWED_UPLOADERS_GROUP)) {
    return response(403, { code: 'UploaderNotAuthorised' });
  }

  const body = parseBody(event.body);
  const uploads = validateUploads(body.uploads);
  const jobId = randomUUID();
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;

  await Promise.all([
    dynamo.send(new PutItemCommand({
      TableName: requiredEnvironment('JOBS_TABLE'),
      Item: {
        jobId: { S: jobId },
        ownerSubject: { S: subject },
        status: { S: 'UPLOAD_PENDING' },
        permissionState: { S: 'MANAGED_UPLOADER_APPROVED' },
        createdAt: { S: now.toISOString() },
        expiresAt: { N: String(expiresAt) },
      },
      ConditionExpression: 'attribute_not_exists(jobId)',
    })),
    dynamo.send(new PutItemCommand({
      TableName: requiredEnvironment('UPLOAD_PERMISSIONS_TABLE'),
      Item: {
        jobId: { S: jobId },
        ownerSubject: { S: subject },
        permissionSource: { S: 'MANAGED_COGNITO_UPLOADER' },
        state: { S: 'APPROVED' },
        createdAt: { S: now.toISOString() },
        expiresAt: { N: String(expiresAt) },
      },
      ConditionExpression: 'attribute_not_exists(jobId)',
    })),
  ]);

  const uploadUrls = await Promise.all(uploads.map(async upload => {
    const key = `${jobId}/${upload.kind}/${randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: requiredEnvironment('INPUT_BUCKET'),
      Key: key,
      ContentType: upload.contentType,
      Metadata: {
        jobid: jobId,
        kind: upload.kind,
      },
    });

    return {
      kind: upload.kind,
      uploadUrl: await getSignedUrl(s3, command, { expiresIn: UPLOAD_TTL_SECONDS }),
      requiredContentType: upload.contentType,
    };
  }));

  return response(201, {
    jobId,
    status: 'UPLOAD_PENDING',
    expiresInSeconds: UPLOAD_TTL_SECONDS,
    uploads: uploadUrls,
  });
}

function parseBody(body: string | null | undefined): { uploads?: unknown } {
  if (!body) {
    throw new RequestError(400, 'RequestBodyRequired');
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new RequestError(400, 'InvalidRequestBody');
    }
    return parsed as { uploads?: unknown };
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, 'InvalidJson');
  }
}

function validateUploads(value: unknown): RequestedUpload[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new RequestError(400, 'InvalidUploadCount');
  }

  const uploads = value.map(upload => upload as Partial<RequestedUpload>);
  const seenKinds = new Set<string>();

  for (const upload of uploads) {
    if (upload.kind !== 'source' && upload.kind !== 'template') {
      throw new RequestError(400, 'UnsupportedUploadKind');
    }
    if (seenKinds.has(upload.kind)) {
      throw new RequestError(400, 'DuplicateUploadKind');
    }
    seenKinds.add(upload.kind);

    if (typeof upload.fileName !== 'string' || upload.fileName.length < 1 || upload.fileName.length > 160) {
      throw new RequestError(400, 'InvalidFileName');
    }
    if (typeof upload.contentType !== 'string' || !allowedTypes[upload.kind].has(upload.contentType)) {
      throw new RequestError(400, 'UnsupportedContentType');
    }
  }

  if (!seenKinds.has('source')) {
    throw new RequestError(400, 'SourceWorkbookRequired');
  }

  return uploads as RequestedUpload[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}

function response(statusCode: number, body: object) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}
