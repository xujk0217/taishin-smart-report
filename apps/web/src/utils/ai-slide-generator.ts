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

const API_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

// ─── System Prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `你是台新新光金控的專業簡報規劃 AI，為高階主管設計信用卡市場分析報告。

## 頁面結構規則（最重要！）

你要生成的簡報必須包含以下結構性頁面＋內容頁面：

### 結構性頁面（不占內容頁名額）
1. **封面** (page 1): layout="cover", background="001"
   - 元素: title（黑色大標題）+ subtitle（報告副標/日期）
2. **目錄** (page 2): layout="toc", background="002"
   - 元素: title="目錄" + bullet_list（列出所有段落標題）
3. **段落標題頁**: layout="section_title", background="001"
   - 每個分析主題前要有一頁，只放 title（黑色）+ subtitle（段落簡述）
4. **封底** (最後一頁): layout="backcover", background="003"
   - 元素: title="謝謝"（黑色）+ subtitle="台新新光金控"

### 內容頁面
- layout="content", background="002"
- 每頁 3-5 個 elements，要有實質數據
- 必須涵蓋使用者需求中的所有分析面向

### 頁面計算範例（15 頁的報告）
- 封面: 1 頁
- 目錄: 1 頁  
- 段落A標題: 1 頁 → 段落A內容: 2-3 頁
- 段落B標題: 1 頁 → 段落B內容: 2-3 頁
- 段落C標題: 1 頁 → 段落C內容: 1-2 頁
- 結論: 1 頁
- 封底: 1 頁
= 共 12-16 頁

## 背景圖
- "001" = 品牌裝飾背景（用於封面、段落標題、封底）
- "002" = 乾淨白底（用於目錄、所有內容頁）
- "003" = 品牌結束頁背景（只用於封底）

## 元素類型
- "title": 標題文字（封面/段落標題/封底用黑色）
- "subtitle": 副標題
- "heading": 內容頁的區塊標題
- "chart": 圖表。需指定 chartType ("line"/"bar") + dataKey
  - dataKey 可選: "market_share_trend", "ranking_latest", "mom_trend", "card_count_trend"
- "text_block": 2-4 句深度分析段落
- "bullet_list": 要點列表，items 陣列
- "kpi_block": 數字展示，metrics: [{label, value, rank?, trend?}]
- "insight": 一句 AI 洞察（精練觀點）
- "comparison": 銀行比較，entities: [{name, value, highlight?}]
- "table": 資料表，headers + rows
- "source": 來源標註（底部小字）

## 內容頁規則
1. 每頁至少含 heading + 2 個以上數據元素
2. 圖表頁搭配 insight + source
3. 至少一頁有 kpi_block
4. 至少一頁有 comparison
5. 結論頁用 bullet_list + kpi_block 總結

## 品質要求
- 每個段落標題頁對應至少 1-3 頁內容頁
- 目錄的 bullet_list 要列出所有段落標題
- 所有數字必須與提供的數據一致
- 頁碼 (page) 必須從 1 連續編到最後

## 輸出格式
回傳純 JSON（不要 markdown 標記）：
{"slides":[{"page":1,"background":"001","layout":"cover","section":"封面","elements":[{"type":"title","content":"..."},{"type":"subtitle","content":"..."}]},{"page":2,"background":"002","layout":"toc","elements":[{"type":"title","content":"目錄"},{"type":"bullet_list","items":["..."]}]},...]}`;

// ─── Validation Prompt ───────────────────────────────────────

const VALIDATION_PROMPT = `你是簡報品質審核員。檢查以下簡報 JSON 是否符合規則，如果有問題就修正後回傳完整 JSON。

檢查項目：
1. page 1 必須是 cover，page 2 必須是 toc（目錄）
2. 最後一頁必須是 backcover
3. 每個段落標題頁 (section_title) 後面必須有至少 1 頁 content
4. 目錄的 bullet_list 是否列出了所有段落
5. 頁碼是否從 1 連續遞增
6. content 頁是否每頁至少有 heading + 2 個數據元素
7. 是否有至少一個 chart, kpi_block, comparison
8. 封面/段落標題/封底的 title 不應該是空的

如果全部正確，直接回傳原始 JSON。如果有問題，修正後回傳。
只回傳 JSON，不要其他文字。`;

// ─── Main Generator ──────────────────────────────────────────

export async function generateSlideSpec(
  prompt: string,
  computeResult: ComputeResult,
  excelSummary: string,
): Promise<PresentationSpec> {
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

  const userMsg = `${excelSummary}\n\n數據摘要:\n${dataSummary}\n\n使用者需求: ${prompt}\n\n請生成 12-16 頁的完整簡報 JSON。記得包含封面、目錄、段落標題頁、內容頁、封底。`;

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
    .filter(m => m.rank && m.rank <= 5 && m.metricName.includes('市占'))
    .slice(0, 5);

  const slides: SlideSpec[] = [
    {
      page: 1, background: '001', layout: 'cover',
      elements: [
        { type: 'title', content: '信用卡市場分析報告', position: 'center' },
        { type: 'subtitle', content: `${result.summary.totalEntities} 家銀行 × ${result.summary.totalPeriods} 個月份 · 114年度` },
      ],
    },
    {
      page: 2, background: '002', layout: 'toc',
      elements: [
        { type: 'title', content: '目錄' },
        { type: 'bullet_list', items: ['一、市場競爭態勢', '二、經營績效分析', '三、結論與策略建議'] },
      ],
    },
    {
      page: 3, background: '001', layout: 'section_title', section: '市場競爭',
      elements: [
        { type: 'title', content: '一、市場競爭態勢' },
        { type: 'subtitle', content: '市占率、排名與銀行間比較' },
      ],
    },
    {
      page: 4, background: '002', layout: 'content', section: '市場競爭',
      elements: [
        { type: 'heading', content: '簽帳金額市占率趨勢' },
        { type: 'chart', chartType: 'line', dataKey: 'market_share_trend' },
        { type: 'insight', content: '前五大銀行合計市占超過 65%，市場集中度高' },
        { type: 'source', content: '資料來源：金管會信用卡重要資訊揭露' },
      ],
    },
    {
      page: 5, background: '002', layout: 'content', section: '市場競爭',
      elements: [
        { type: 'heading', content: '最新月份銀行排名' },
        { type: 'chart', chartType: 'bar', dataKey: 'ranking_latest' },
        { type: 'comparison', entities: top5.map(m => ({ name: m.entity, value: `${m.value}%`, highlight: m.entity.includes('台新') })) },
        { type: 'source', content: '資料來源：金管會信用卡重要資訊揭露' },
      ],
    },
    {
      page: 6, background: '001', layout: 'section_title', section: '經營績效',
      elements: [
        { type: 'title', content: '二、經營績效分析' },
        { type: 'subtitle', content: '月增率、流通卡數與關鍵指標' },
      ],
    },
    {
      page: 7, background: '002', layout: 'content', section: '經營績效',
      elements: [
        { type: 'heading', content: '簽帳金額月增率趨勢' },
        { type: 'chart', chartType: 'line', dataKey: 'mom_trend' },
        { type: 'text_block', content: '各銀行簽帳金額月增率反映消費動能變化，年末因消費旺季通常呈現正成長。台新12月月增率表現強勁。' },
        { type: 'insight', content: '台新12月月增率 +11.62%，高於市場平均' },
        { type: 'source', content: '資料來源：金管會信用卡重要資訊揭露' },
      ],
    },
    {
      page: 8, background: '002', layout: 'content', section: '經營績效',
      elements: [
        { type: 'heading', content: '台新關鍵經營指標' },
        { type: 'kpi_block', metrics: [
          { label: '簽帳金額市占率', value: `${top5.find(m => m.entity.includes('台新'))?.value ?? 10.67}%`, rank: 5 },
          { label: '月增率', value: '+11.62%', trend: '↑' },
          { label: '排名', value: '第 5 名' },
        ]},
        { type: 'bullet_list', items: [
          '市占率穩定維持 10-11% 區間',
          '12月消費旺季帶動簽帳金額成長',
          '流通卡數穩定，有效卡率維持健康水準',
        ]},
      ],
    },
    {
      page: 9, background: '001', layout: 'section_title', section: '結論',
      elements: [
        { type: 'title', content: '三、結論與策略建議' },
        { type: 'subtitle', content: '綜合分析與下一步建議' },
      ],
    },
    {
      page: 10, background: '002', layout: 'content', section: '結論',
      elements: [
        { type: 'heading', content: '策略建議' },
        { type: 'bullet_list', items: [
          '台新市占率穩定在第 5 名，與第 4 名差距不到 1 個百分點',
          '市場前三名（中信、國泰、富邦）合計超過 49%',
          '建議：深耕高消費族群，把握年末旺季',
          '建議：關注有效卡率提升，降低停卡率',
          '建議：強化數位支付場景，提升年輕族群滲透率',
        ]},
        { type: 'kpi_block', metrics: [
          { label: '目標市占率', value: '11%+', trend: '↑' },
          { label: '當前排名', value: '第 5', rank: 5 },
          { label: '與第4名差距', value: '0.53%' },
        ]},
      ],
    },
    {
      page: 11, background: '003', layout: 'backcover',
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
