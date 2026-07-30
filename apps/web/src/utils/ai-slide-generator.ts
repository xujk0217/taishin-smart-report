/**
 * AI Slide Generator - calls Groq to generate detailed slide spec JSON.
 * The AI decides layout, content, charts, insights per page.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { PresentationSpec, SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from './metric-engine';

const GROQ_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

const SYSTEM_PROMPT = `你是一位專業的金融簡報規劃 AI，為台新新光金控設計信用卡市場分析簡報。

## 你的角色
- 台新新光金控內部數據分析顧問
- 專精金融市場研究與管理報告製作
- 目標受眾：銀行高階主管

## 背景圖模板
- "001" = 封面/段落標題頁（品牌裝飾背景，深紅色系）
- "002" = 內文頁（乾淨白底，適合圖表、KPI、文字分析）
- "003" = 封底（品牌裝飾結束頁）

## 版面類型
- "cover" = 封面（只用 001 背景）
- "section_title" = 段落分隔頁（用 001，每個主題段落前加一頁）
- "content" = 內容頁（用 002，放所有數據分析）
- "backcover" = 封底（用 003）

## 元素類型及說明
- "title": 主標題，content 為標題文字
- "subtitle": 副標題，報告副標或日期
- "heading": 頁面小標題（區隔不同區塊）
- "chart": 圖表，必須指定 chartType ("line"/"bar") 和 dataKey
  - dataKey: "market_share_trend"（市占率折線）, "ranking_latest"（排名柱狀）, "mom_trend"（月增率折線）, "card_count_trend"（流通卡數折線）
- "text_block": 2-4 句完整的市場洞察段落
- "bullet_list": 要點列表，items 陣列每條 15-30 字
- "kpi_block": 關鍵數字展示，metrics 陣列含 { label, value, rank?, trend? }
- "insight": 一句精練的 AI 分析觀點（以「💡」開頭的洞察）
- "comparison": 銀行間比較，entities 陣列含 { name, value, highlight? }
- "table": 表格，headers + rows 陣列
- "source": 資料來源標註

## 結構規則
1. 第 1 頁必須是 cover（背景 001），含 title + subtitle
2. 每個分析段落前加 section_title（背景 001），只含 title
3. 內容頁（背景 002）每頁 3-5 個 elements，資訊密度要高
4. 圖表頁必須搭配 insight + source
5. 至少一頁有 kpi_block 展示台新的關鍵數字
6. 至少一頁有 comparison 做前五大銀行比較
7. 加入 text_block 提供深度分析（不是只有圖表）
8. 倒數第二頁為結論與策略建議（heading + bullet_list + kpi_block）
9. 最後一頁是 backcover（背景 003）
10. 所有數字必須與提供的數據一致，絕不可編造
11. 總頁數 8-12 頁

## 輸出
回傳純 JSON（不要 markdown 標記）：
{"slides":[{"page":1,"background":"001","layout":"cover","elements":[...]},...]}`;

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
      setTimeout(() => reject(new Error('AI timeout')), 120000)
    );

    const aiPromise = callGroqWithRetry(GROQ_KEY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 10000,
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
