/**
 * Quick integration test: generate a PPTX from pipeline output.
 * Run with: npx tsx src/test-generate.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderPptx } from './renderer.js';

async function main() {
  // Read pipeline output
  const pipelineOutputDir = '../../services/parser-metrics/output';
  
  const chartDataSpecs = JSON.parse(
    readFileSync(`${pipelineOutputDir}/chart-data-specs.json`, 'utf-8')
  );
  const metrics = JSON.parse(
    readFileSync(`${pipelineOutputDir}/metrics.json`, 'utf-8')
  );

  // Build a simple SlideDeckSpec for demo
  const slideDeckSpec = {
    specId: 'demo-spec-001',
    jobId: 'local-dev-001',
    slides: [
      {
        slideIndex: 0,
        layout: 'cover',
        masterId: 'cover-master',
        content: {
          title: '台新信用卡 114 年度市場分析',
          subtitle: '月度簽帳金額與市占趨勢報告',
        },
      },
      {
        slideIndex: 1,
        layout: 'section',
        masterId: 'section-master',
        content: {
          title: '市場競爭分析',
        },
      },
      // Add chart slides for each chart data spec
      ...chartDataSpecs.slice(0, 4).map((spec: any, idx: number) => ({
        slideIndex: idx + 2,
        layout: 'chart',
        masterId: 'chart-master',
        content: {
          title: `${spec.series[0]?.name || ''} 趨勢分析`,
          chart: {
            type: 'line',
            chartDataSpecId: spec.chartDataSpecId,
            xAxis: { label: '月份' },
            yAxis: { label: '數值' },
          },
        },
      })),
      {
        slideIndex: chartDataSpecs.length + 2,
        layout: 'conclusion',
        masterId: 'conclusion-master',
        content: {
          title: '結論與建議',
          body: '台新銀行在信用卡市場維持穩定競爭地位，建議持續關注市占率變化趨勢。',
        },
      },
    ],
  };

  console.log(`Rendering PPTX with ${slideDeckSpec.slides.length} slides...`);
  
  const result = await renderPptx({
    slideDeckSpec,
    chartDataSpecs,
  });

  const outputPath = `${pipelineOutputDir}/output.pptx`;
  writeFileSync(outputPath, result.buffer);
  
  console.log(`✅ PPTX generated: ${outputPath}`);
  console.log(`   Slides: ${result.slideCount}`);
  console.log(`   Charts: ${result.chartCount} (native editable)`);
  console.log(`   Tables: ${result.tableCount} (native)`);
}

main().catch(console.error);
