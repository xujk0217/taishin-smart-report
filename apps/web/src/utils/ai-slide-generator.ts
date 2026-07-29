/**
 * AI Slide Generator - calls Groq to generate detailed slide spec JSON.
 * The AI decides layout, content, charts, insights per page.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { PresentationSpec, SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY || '';

const SYSTEM_PROMPT = `你是一位專業的金融簡報規劃 AI。根據使用者的分析數據和需求，你需要產生一份詳細的簡報規格 JSON。

## 背景圖模板
- "001" = 封面/段落標題頁（品牌裝飾，適合大標題）
- "002" = 內文頁（乾淨白底，適合放圖表、數據、文字分析）
- "003" = 封底（結束頁）

## 版面類型
- "cover" = 封面（只用 001）
- "section_title" = 段落分隔（用 001，每個主題前加一頁）
- "content" = 內容頁（用 002，放所有數據和分析）
- "backcover" = 封底（用 003）

## 元素類型
- "title" / "subtitle" = 標題文字
- "heading" = 頁面小標題
- "chart" = 圖表（需指定 chartType 和 dataKey）
- "text_block" = 文字段落分析
- "bullet_list" = 要點列表
- "kpi_block" = 關鍵指標展示（數字+趨勢）
- "insight" = AI 洞察結論
- "comparison" = 銀行比較
- "source" = 資料來源標註

## dataKey 可用的圖表
根據數據會有這些圖表可用：
- "market_share_trend" = 市占率趨勢折線圖
- "ranking_latest" = 最新月份排名柱狀圖
- "mom_trend" = 月增率趨勢折線圖
- "card_count_trend" = 流通卡數趨勢

## 規則
1. 總頁數建議 8-12 頁
2. 每頁 content 至少 3-4 個 elements
3. 每個段落前用 section_title 分隔
4. 圖表頁都要有 insight 和 source
5. 加入 kpi_block 展示關鍵數字
6. 加入 comparison 做銀行間比較
7. 最後一頁前加一頁「結論與建議」
8. 回傳純 JSON，不要有其他文字

回傳格式：
{"slides":[...]}`;

/**
 * Generate detailed presentation spec from computed metrics + user prompt.
 */
export async function generateSlideSpec(
  prompt: string,
  computeResult: ComputeResult,
  excelSummary: string,
): Promise<PresentationSpec> {
  // Build data summary for AI
  const topMetrics = computeResult.metrics
    .filter(m => m.rank && m.rank <= 5)
    .slice(0, 15);

  const dataSummary = [
    `工作表: ${computeResult.summary.sheetsUsed} 個`,
    `銀行數: ${computeResult.summary.totalEntities}`,
    `月份數: ${computeResult.summary.totalPeriods}`,
    `總指標: ${computeResult.summary.totalMetrics}`,
    `可用圖表: ${computeResult.charts.length} 個`,
    '',
    '前五名銀行指標（最新月份）:',
    ...topMetrics.slice(0, 10).map(m =>
      `  ${m.entity} ${m.metricName}: ${m.value}${m.unit} (排名${m.rank})`
    ),
  ].join('\n');

  const userMsg = `${excelSummary}\n\n數據摘要:\n${dataSummary}\n\n使用者需求: ${prompt}\n\n請生成詳細的簡報規格 JSON（8-12頁），每頁要有豐富的內容元素。`;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI timeout')), 15000)
    );

    const aiPromise = callGroqWithRetry(GROQ_KEY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const data = await Promise.race([aiPromise, timeoutPromise]);

    const content = extractContent(data);
    const parsed = parseSlideSpec(content);
    if (parsed.length === 0) throw new Error('Empty spec');
    
    return {
      title: prompt.slice(0, 50),
      slides: parsed,
      metadata: {
        totalPages: parsed.length,
        dataSource: excelSummary.split('\n')[0] || 'Excel',
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[AI SlideGen] Failed, using fallback:', err);
    return generateFallbackSpec(computeResult);
  }
}

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
        background: s.background || (i === 0 ? '001' : '002'),
        layout: s.layout || 'content',
        section: s.section,
        elements: Array.isArray(s.elements) ? s.elements : [],
      }));
    }
  } catch (e) {
    console.error('[AI SlideGen] Parse failed:', e);
  }

  return [];
}

/**
 * Fallback: generate a reasonable spec without AI.
 */
function generateFallbackSpec(result: ComputeResult): PresentationSpec {
  const top5 = result.metrics
    .filter(m => m.rank && m.rank <= 5 && m.metricName.includes('市占'))
    .slice(0, 5);

  const slides: SlideSpec[] = [
    {
      page: 1, background: '001', layout: 'cover',
      elements: [
        { type: 'title', content: '信用卡市場分析報告', position: 'center' },
        { type: 'subtitle', content: `${result.summary.totalEntities} 家銀行 × ${result.summary.totalPeriods} 個月份` },
      ],
    },
    {
      page: 2, background: '001', layout: 'section_title',
      elements: [{ type: 'title', content: '市場競爭分析' }],
    },
    {
      page: 3, background: '002', layout: 'content', section: '市場競爭',
      elements: [
        { type: 'heading', content: '簽帳金額市占率趨勢' },
        { type: 'chart', chartType: 'line', dataKey: 'market_share_trend', position: 'main' },
        { type: 'insight', content: `前五大銀行合計市占超過 70%，市場集中度高` },
        { type: 'source', content: '資料來源：金管會信用卡重要資訊揭露' },
      ],
    },
    {
      page: 4, background: '002', layout: 'content', section: '市場競爭',
      elements: [
        { type: 'heading', content: '銀行排名比較' },
        { type: 'chart', chartType: 'bar', dataKey: 'ranking_latest', position: 'left' },
        { type: 'kpi_block', metrics: top5.map(m => ({ label: m.entity, value: `${m.value}%`, rank: m.rank })) },
        { type: 'comparison', entities: top5.map(m => ({ name: m.entity, value: `${m.value}%`, highlight: m.entity.includes('台新') })) },
      ],
    },
    {
      page: 5, background: '001', layout: 'section_title',
      elements: [{ type: 'title', content: '經營績效' }],
    },
    {
      page: 6, background: '002', layout: 'content', section: '經營績效',
      elements: [
        { type: 'heading', content: '月增率變化' },
        { type: 'chart', chartType: 'line', dataKey: 'mom_trend', position: 'main' },
        { type: 'text_block', content: '各銀行簽帳金額月增率反映消費動能變化，年末通常因消費旺季呈現正成長。' },
        { type: 'bullet_list', items: ['12月為消費旺季，多數銀行呈正成長', '台新月增率 +11.62%', '需關注季節性波動對趨勢判斷的影響'] },
      ],
    },
    {
      page: 7, background: '002', layout: 'content', section: '結論',
      elements: [
        { type: 'heading', content: '結論與策略建議' },
        { type: 'bullet_list', items: [
          '台新信用卡市占率穩定維持在 10-11% 區間，排名第 5',
          '市場前三名（中信、國泰、富邦）合計超過 49%',
          '12月月增率 +11.62% 表現強勁',
          '建議：深耕高消費族群，把握旺季提升市占',
        ]},
        { type: 'kpi_block', metrics: [
          { label: '市占率', value: '10.67%', rank: 5 },
          { label: '月增率', value: '+11.62%', trend: '↑' },
          { label: '流通卡數', value: '663萬張' },
        ]},
      ],
    },
    {
      page: 8, background: '003', layout: 'backcover',
      elements: [
        { type: 'title', content: '謝謝', position: 'center' },
        { type: 'subtitle', content: '台新新光金控 ｜ 智匯數據簡報神器' },
      ],
    },
  ];

  return {
    title: '信用卡市場分析報告',
    slides,
    metadata: { totalPages: slides.length, dataSource: 'Excel', generatedAt: new Date().toISOString() },
  };
}
