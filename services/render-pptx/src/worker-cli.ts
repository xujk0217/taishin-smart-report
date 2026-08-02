import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderPptx } from './renderer.js';

interface WorkerRequest {
  slideDeckSpecPath: string;
  chartDataSpecsPath: string;
  outputPath: string;
  reportPath: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error('Usage: tsx src/worker-cli.ts <request.json>');
  }

  const request = readJson(requestPath) as WorkerRequest;
  for (const field of ['slideDeckSpecPath', 'chartDataSpecsPath', 'outputPath', 'reportPath'] as const) {
    if (typeof request[field] !== 'string' || request[field].length === 0) {
      throw new Error(`Missing worker request field: ${field}`);
    }
  }

  const outputPath = resolve(request.outputPath);
  const reportPath = resolve(request.reportPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  const result = await renderPptx({
    slideDeckSpec: readJson(request.slideDeckSpecPath) as Parameters<typeof renderPptx>[0]['slideDeckSpec'],
    chartDataSpecs: readJson(request.chartDataSpecsPath) as Parameters<typeof renderPptx>[0]['chartDataSpecs'],
  });

  writeFileSync(outputPath, result.buffer);
  writeFileSync(reportPath, JSON.stringify({
    outputPath,
    sizeBytes: result.buffer.byteLength,
    slideCount: result.slideCount,
    chartCount: result.chartCount,
    tableCount: result.tableCount,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
