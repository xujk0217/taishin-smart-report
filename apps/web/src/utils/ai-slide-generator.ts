/**
 * AI Slide Generator — calls LLM to produce a detailed slide spec JSON.
 *
 * Two-pass approach:
 *   1. Generate the spec
 *   2. Validate it (AI checks its own output for completeness/correctness)
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { PresentationSpec, SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';
import type { PipelineResult } from './ai-pipeline';

/**
 * Renders the pipeline's blueprint, insights, and design directives into a
 * brief the slide generator must follow.
 */
function buildBlueprintBrief(pipeline: PipelineResult): string {
  const { audience, architecture, insights, metrics } = pipeline;

  const directives = [
    audience.designDirectives.length ? `版面與視覺：${audience.designDirectives.join('；')}` : '',
    audience.narrativeStyle.length ? `文字敘述：${audience.narrativeStyle.join('；')}` : '',
    audience.chartPreferences.length ? `圖表偏好：${audience.chartPreferences.join('；')}` : '',
    audience.constraints.length ? `必須遵守：${audience.constraints.join('；')}` : '',
  ].filter(Boolean);

  const pageLines: string[] = [];
  let page = 1;
  for (const section of architecture.sections) {
    pageLines.push(`  段落「${section.title}」— ${section.purpose}`);
    for (const p of section.pages) {
      const refs = [
        p.metricIds?.length ? `指標 ${p.metricIds.join(',')}` : '',
        p.insightTopics?.length ? `洞察 ${p.insightTopics.join('／')}` : '',
      ].filter(Boolean).join('｜');
      pageLines.push(
        `    第 ${page} 頁 [${p.layout}] ${p.pageTitle}`,
        `      這頁的訊息：${p.message}`,
        `      要放的元素：${p.elements.join('、')}${refs ? `　（${refs}）` : ''}`,
      );
      page++;
    }
  }

  return [
    '## 報告設定',
    `對象：${audience.audience}`,
    `目的：${audience.purpose}`,
    `語氣：${audience.tone}`,
    `深度：${audience.depth}`,
    directives.length ? `\n## 使用者的設計要求\n${directives.join('\n')}` : '',
    '',
    '## 簡報主軸',
    architecture.narrative,
    '',
    `## 簡報藍圖（共 ${architecture.totalPages} 頁，必須完全照做）`,
    pageLines.join('\n'),
    '',
    '## 可引用的指標',
    metrics.filter(m => m.supported).map(m => `[${m.id}] ${m.name} = ${m.definition}`).join('\n'),
    '',
    '## 可引用的洞察',
    insights.map(i => `【${i.topic}】${i.keyFinding}\n  意涵：${i.implication}\n  建議：${i.recommendation}`).join('\n'),
    '',
  ].filter(Boolean).join('\n');
}

const API_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

// ─── System Prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `你是專業的簡報規劃 AI，為使用者將資料轉化為簡報。

## 你的自由度
你可以完全自由決定：
- 簡報的結構（要不要目錄、要不要段落標題頁、要幾頁）
- 每頁的內容組合（哪些元素、多少個、什麼順序）
- 圖表的類型和數據選擇
- 文字敘述的風格和深度
- 是否需要封面/封底（通常需要，但不強制）

## 建議結構（僅供參考，你可以自由調整）
- 一般簡報會有封面 → 內容頁 → 結論 → 封底
- 內容較多時可加目錄頁和段落標題頁
- 但如果使用者只要 3 頁，你可以跳過目錄和段落標題

## 背景圖
- "001" = 品牌裝飾背景（適合封面、段落標題）
- "002" = 乾淨白底（適合資料密集的內容頁）
- "003" = 深色結束背景（適合封底）

## Layout 類型
- "cover": 封面（居中大標題）
- "toc": 目錄
- "section_title": 段落標題頁（居中）
- "content": 一般內容頁
- "backcover": 封底

## 元素類型（AI 自由選用）
- "title": 標題
- "subtitle": 副標題
- "heading": 內容頁區塊標題
- "chart": 圖表，指定 chartType ("line"/"bar"/"pie") + dataKey（對應計算引擎的 chartId）
- "text_block": 段落文字（長度不限）
- "bullet_list": 要點列表，items 陣列
- "kpi_block": 數字展示，metrics: [{label, value, rank?, trend?}]
- "insight": 洞察觀點
- "comparison": 比較，entities: [{name, value, highlight?}]
- "table": 資料表，headers + rows
- "source": 來源標註

## 版面 size 欄位
每個元素可帶 size: "small" / "medium" / "large" / "full"，表示佔頁面比例。
AI 自行判斷每個元素應該多大。

## 頁數規則
- 若使用者訊息中有「簡報藍圖」，依藍圖頁數
- 若使用者指定頁數，依指定
- 否則 AI 根據資料量和需求自行決定

## 品質要求
- 所有數字必須與提供的數據一致
- 頁碼 (page) 從 1 連續編號
- 每個欄位都要填真實內容，嚴禁空字串或 "..."
- 標題要有資訊量，不要只寫一個標籤

## 輸出格式
回傳純 JSON（不要 markdown 標記）：
{
  "slides": [
    {
      "page": 1,
      "background": "001",
      "layout": "cover",
      "section": "（可選）",
      "elements": [...]
    }
  ]
}`;

// ─── Validation Prompt ───────────────────────────────────────

const VALIDATION_PROMPT = `你是簡報品質審核員。檢查以下簡報 JSON 是否有品質問題，如果有就修正後回傳完整 JSON。

檢查項目：
1. 頁碼是否從 1 連續遞增
2. 每個元素是否都有實際內容（不是空字串或 "..."）
3. 如果有 chart 元素，是否有指定 chartType 和 dataKey
4. 內容頁是否至少有 1 個有意義的元素
5. 整體簡報是否有完整的開頭和結尾

如果全部正確，直接回傳原始 JSON。如果有問題，修正後回傳。
只回傳 JSON，不要其他文字。`;

// ─── Main Generator ──────────────────────────────────────────

export async function generateSlideSpec(
  prompt: string,
  computeResult: ComputeResult,
  excelSummary: string,
  pipeline?: PipelineResult,
): Promise<PresentationSpec> {
  const topMetrics = computeResult.metrics
    .filter(m => m.rank && m.rank <= 5)
    .slice(0, 15);

  const dataSummary = [
    `工作表: ${computeResult.summary.sheetsUsed} 個`,
    `實體數: ${computeResult.summary.totalEntities}`,
    `期間數: ${computeResult.summary.totalPeriods}`,
    `總指標: ${computeResult.summary.totalMetrics}`,
    `可用圖表: ${computeResult.charts.length} 個`,
    '',
    '前五名指標（最新期間）:',
    ...topMetrics.slice(0, 10).map(m =>
      `  ${m.entity} ${m.metricName}: ${m.value}${m.unit} (排名${m.rank})`
    ),
  ].join('\n');

  // When the pipeline ran, follow its blueprint page by page instead of
  // letting the model invent a fresh structure.
  const blueprintBlock = pipeline ? buildBlueprintBrief(pipeline) : '';
  const targetPages = pipeline?.architecture.totalPages ?? 14;

  const userMsg = [
    excelSummary,
    '',
    '數據摘要:',
    dataSummary,
    '',
    blueprintBlock,
    `使用者需求原文: ${prompt}`,
    '',
    pipeline
      ? `請完全依照上面的簡報藍圖產生 ${targetPages} 頁的 JSON。每一頁的 pageTitle、layout、message、elements 都要落實，不可增減頁數。`
      : `請生成 ${targetPages} 頁的完整簡報 JSON，包含封面、目錄、段落標題頁、內容頁、封底。`,
  ].filter(Boolean).join('\n');

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI timeout')), 120000)
    );

    // ── Pass 1: Generate ──
    const genPromise = callGroqWithRetry(API_KEY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 12000,
    });

    const genData = await Promise.race([genPromise, timeout]);
    const genContent = extractContent(genData);
    let slides = parseSlideSpec(genContent);

    if (slides.length === 0) throw new Error('Empty spec from AI');

    // ── Pass 2: Validate & Fix ──
    try {
      const valPromise = callGroqWithRetry(API_KEY, {
        messages: [
          { role: 'system', content: VALIDATION_PROMPT },
          { role: 'user', content: JSON.stringify({ slides }, null, 1) },
        ],
        temperature: 0.1,
        max_tokens: 12000,
      });

      const valData = await Promise.race([valPromise, timeout]);
      const valContent = extractContent(valData);
      const validated = parseSlideSpec(valContent);

      if (validated.length >= slides.length) {
        slides = validated;
        console.log('[SlideGen] Validation pass applied');
      }
    } catch (valErr) {
      console.warn('[SlideGen] Validation pass failed, using original:', valErr);
    }

    // ── Post-processing: ensure page numbers are sequential ──
    slides = slides.map((s, i) => ({ ...s, page: i + 1 }));

    return {
      title: prompt.slice(0, 50),
      slides,
      metadata: {
        totalPages: slides.length,
        dataSource: excelSummary.split('\n')[0] || 'Excel',
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[SlideGen] Failed, using fallback:', err);
    return generateFallbackSpec(computeResult);
  }
}

// ─── Parser ──────────────────────────────────────────────────

function parseSlideSpec(text: string): SlideSpec[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end);
  }

  try {
    const obj = JSON.parse(cleaned);
    const slides = obj.slides || obj;
    if (Array.isArray(slides) && slides.length > 0) {
      return slides.map((s: any, i: number) => ({
        page: s.page || i + 1,
        background: s.background || (s.layout === 'content' || s.layout === 'toc' ? '002' : '001'),
        layout: s.layout || 'content',
        section: s.section,
        elements: Array.isArray(s.elements) ? s.elements : [],
      }));
    }
  } catch (e) {
    console.error('[SlideGen] Parse failed:', e);
  }

  return [];
}

// ─── Fallback Spec ───────────────────────────────────────────

function generateFallbackSpec(result: ComputeResult): PresentationSpec {
  const top5 = result.metrics
    .filter(m => m.rank && m.rank <= 5)
    .slice(0, 5);

  // Derive section/chart titles from actual data rather than hard-coding
  const chartTitles = result.charts.map(c => c.title);
  const firstChart = result.charts[0];
  const secondChart = result.charts[1];

  const slides: SlideSpec[] = [
    {
      page: 1, background: '001', layout: 'cover',
      elements: [
        { type: 'title', content: '數據分析報告', position: 'center' },
        { type: 'subtitle', content: `${result.summary.totalEntities} 個項目 × ${result.summary.totalPeriods} 個期間 · 智匯數據簡報神器` },
      ],
    },
    {
      page: 2, background: '002', layout: 'toc',
      elements: [
        { type: 'title', content: '目錄' },
        { type: 'bullet_list', items: ['一、數據概覽', '二、趨勢分析', '三、結論與建議'] },
      ],
    },
    {
      page: 3, background: '001', layout: 'section_title', section: '數據概覽',
      elements: [
        { type: 'title', content: '一、數據概覽' },
        { type: 'subtitle', content: firstChart?.title ?? '關鍵指標與排名' },
      ],
    },
    {
      page: 4, background: '002', layout: 'content', section: '數據概覽',
      elements: [
        { type: 'heading', content: firstChart?.title ?? '指標趨勢' },
        { type: 'chart', chartType: (firstChart?.type ?? 'line') as 'line' | 'bar' | 'pie', dataKey: firstChart?.chartId ?? 'chart-1' },
        ...(top5.length > 0 ? [{
          type: 'kpi_block' as const,
          metrics: top5.slice(0, 3).map(m => ({
            label: m.metricName, value: `${m.value}${m.unit}`, rank: m.rank,
          })),
        }] : []),
        { type: 'source', content: '資料來源：使用者上傳之報表' },
      ],
    },
    {
      page: 5, background: '002', layout: 'content', section: '數據概覽',
      elements: [
        { type: 'heading', content: secondChart?.title ?? '排名比較' },
        ...(secondChart
          ? [{ type: 'chart' as const, chartType: (secondChart.type ?? 'bar') as 'line' | 'bar' | 'pie', dataKey: secondChart.chartId }]
          : []),
        ...(top5.length > 0 ? [{
          type: 'comparison' as const,
          entities: top5.map(m => ({ name: m.entity, value: `${m.value}${m.unit}`, highlight: m.rank === 1 })),
        }] : []),
        { type: 'source', content: '資料來源：使用者上傳之報表' },
      ],
    },
    {
      page: 6, background: '001', layout: 'section_title', section: '趨勢分析',
      elements: [
        { type: 'title', content: '二、趨勢分析' },
        { type: 'subtitle', content: '期間變化與關鍵發現' },
      ],
    },
    {
      page: 7, background: '002', layout: 'content', section: '趨勢分析',
      elements: [
        { type: 'heading', content: result.charts[2]?.title ?? '期間變化分析' },
        ...(result.charts[2]
          ? [{ type: 'chart' as const, chartType: (result.charts[2].type ?? 'line') as 'line' | 'bar' | 'pie', dataKey: result.charts[2].chartId }]
          : [{ type: 'text_block' as const, content: '根據上傳資料進行的趨勢分析，詳細內容由 AI 生成。' }]),
        { type: 'source', content: '資料來源：使用者上傳之報表' },
      ],
    },
    {
      page: 8, background: '001', layout: 'section_title', section: '結論',
      elements: [
        { type: 'title', content: '三、結論與建議' },
        { type: 'subtitle', content: '綜合分析結果' },
      ],
    },
    {
      page: 9, background: '002', layout: 'content', section: '結論',
      elements: [
        { type: 'heading', content: '分析摘要' },
        { type: 'text_block', content: `本報告涵蓋 ${result.summary.totalEntities} 個分析項目、${result.summary.totalPeriods} 個期間，共計算 ${result.summary.totalMetrics} 項指標。` },
        ...(top5.length > 0 ? [{
          type: 'kpi_block' as const,
          metrics: top5.slice(0, 3).map(m => ({
            label: m.entity, value: `${m.value}${m.unit}`, rank: m.rank,
          })),
        }] : []),
      ],
    },
    {
      page: 10, background: '003', layout: 'backcover',
      elements: [
        { type: 'title', content: '謝謝', position: 'center' },
        { type: 'subtitle', content: '智匯數據簡報神器' },
      ],
    },
  ];

  return {
    title: '數據分析報告',
    slides,
    metadata: { totalPages: slides.length, dataSource: 'Excel', generatedAt: new Date().toISOString() },
  };
}
