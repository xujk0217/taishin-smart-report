/**
 * Natural-language slide editing with minimal guardrails.
 *
 * AI has full freedom to restructure slides (add/remove/reorder elements,
 * change types, rewrite text). The only protection is: computed data values
 * (numbers in kpi_block, comparison, table) and chart dataKey bindings
 * must be preserved to maintain data integrity.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { SlideSpec, SlideElement } from '../types/slide-spec';

const GROQ_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

export interface EditViolation {
  code: 'NUMBER_CHANGED' | 'RANK_CHANGED' | 'SOURCE_REMOVED' | 'CHART_REBOUND'
      | 'ELEMENT_TYPE_CHANGED' | 'DATA_ELEMENT_REMOVED' | 'INVALID_SHAPE';
  message: string;
}

export interface EditResult {
  ok: boolean;
  slide?: SlideSpec;
  violations: EditViolation[];
  changes: string[];
}

const SYSTEM_PROMPT = `你是簡報編輯助理，負責依指示修改單一投影片的 JSON 規格。

核心規則（保護數據正確性）：
1. 不可更改任何來自計算的數字（如 kpi_block 的 value、comparison 的 value、table 中的數字）
2. 不可更改 chart 的 dataKey（這關聯到實際計算資料）

你可以做的（AI 完全自由）：
- 改寫任何文字內容（標題、段落、洞察、列表）
- 新增或刪除元素（例如加一個 insight、刪一個 bullet_list）
- 改變元素順序
- 改變元素的 type（例如把 text_block 改成 bullet_list）
- 修改 section 名稱
- 調整 size 欄位
- 改變 chart 的 chartType（例如 bar → pie）

只回傳修改後的完整 JSON 物件，不要有其他文字或 markdown 標記。`;

// ─── Validation ──────────────────────────────────────────────

/**
 * Only protects: computed numeric values and chart dataKey bindings.
 * AI is free to restructure everything else.
 */
export function validateEdit(original: SlideSpec, proposed: unknown): EditViolation[] {
  const v: EditViolation[] = [];

  if (!proposed || typeof proposed !== 'object') {
    return [{ code: 'INVALID_SHAPE', message: 'AI 回傳的格式無法解析' }];
  }
  const cand = proposed as Partial<SlideSpec>;
  if (!Array.isArray(cand.elements)) {
    return [{ code: 'INVALID_SHAPE', message: 'AI 回傳的內容缺少 elements 陣列' }];
  }

  // Check that key data numbers weren't altered
  const originalNums = extractDataNumbers(original.elements);
  const proposedNums = extractDataNumbers(cand.elements as SlideElement[]);

  for (const num of originalNums) {
    if (!proposedNums.some(n => Math.abs(n - num) < 0.005)) {
      v.push({
        code: 'NUMBER_CHANGED',
        message: `原始數據中的 ${num} 在修改後消失了`,
      });
    }
  }

  // Check chart dataKey preservation
  const originalCharts = original.elements.filter(e => e.type === 'chart');
  const proposedCharts = (cand.elements as SlideElement[]).filter(e => e.type === 'chart');
  for (const oc of originalCharts) {
    if (oc.dataKey && !proposedCharts.some(pc => pc.dataKey === oc.dataKey)) {
      v.push({
        code: 'CHART_REBOUND',
        message: `圖表 dataKey "${oc.dataKey}" 被移除或更改，可能導致資料斷連`,
      });
    }
  }

  return v;
}

/** Extract numbers from data-carrying elements only. */
function extractDataNumbers(elements: SlideElement[]): number[] {
  const nums: number[] = [];
  for (const el of elements) {
    if (el.type === 'kpi_block' && el.metrics) {
      for (const m of el.metrics) {
        const found = m.value.match(/-?\d+(?:\.\d+)?/g);
        if (found) nums.push(...found.map(Number));
      }
    }
    if (el.type === 'comparison' && el.entities) {
      for (const e of el.entities) {
        const found = e.value.match(/-?\d+(?:\.\d+)?/g);
        if (found) nums.push(...found.map(Number));
      }
    }
    if (el.type === 'table' && el.rows) {
      for (const row of el.rows) {
        for (const cell of row) {
          const found = cell.match(/-?\d+(?:\.\d+)?/g);
          if (found) nums.push(...found.map(Number));
        }
      }
    }
  }
  return nums;
}

// ─── Helpers ─────────────────────────────────────────────────

function truncate(s?: string, n = 24): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function describeChanges(original: SlideSpec, edited: SlideSpec): string[] {
  const out: string[] = [];
  if (original.section !== edited.section) {
    out.push(`段落名稱：${original.section ?? '無'} → ${edited.section ?? '無'}`);
  }
  if (original.elements.length !== edited.elements.length) {
    out.push(`元素數量：${original.elements.length} → ${edited.elements.length}`);
  }
  const minLen = Math.min(original.elements.length, edited.elements.length);
  for (let i = 0; i < minLen; i++) {
    const a = original.elements[i];
    const b = edited.elements[i];
    if (a.type !== b.type) {
      out.push(`元素 ${i + 1}：${a.type} → ${b.type}`);
    } else if (a.type === 'bullet_list') {
      const ja = JSON.stringify(a.items ?? []);
      const jb = JSON.stringify(b.items ?? []);
      if (ja !== jb) out.push(`要點列表已改寫（${(b.items ?? []).length} 條）`);
    } else if (a.content !== b.content && (a.content || b.content)) {
      out.push(`${a.type}：「${truncate(a.content)}」→「${truncate(b.content)}」`);
    }
  }
  return out;
}

function parseJson(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ─── Main edit function ──────────────────────────────────────

/**
 * Applies a natural-language instruction to one slide.
 * AI has full freedom to restructure; only data values are protected.
 */
export async function editSlide(
  slide: SlideSpec,
  instruction: string,
): Promise<EditResult> {
  if (!GROQ_KEY) {
    return {
      ok: false,
      violations: [{ code: 'INVALID_SHAPE', message: '尚未設定 AI 金鑰，無法執行編輯' }],
      changes: [],
    };
  }

  const userMsg = [
    '目前投影片 JSON：',
    JSON.stringify(slide, null, 1),
    '',
    `修改指示：${instruction}`,
    '',
    '請回傳修改後的完整 JSON。',
  ].join('\n');

  let raw: string;
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('AI 回應逾時')), 120000),
    );
    const call = callGroqWithRetry(GROQ_KEY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.25,
      max_tokens: 4000,
    });
    raw = extractContent(await Promise.race([call, timeout]));
  } catch (err: any) {
    return {
      ok: false,
      violations: [{ code: 'INVALID_SHAPE', message: `AI 呼叫失敗：${err?.message ?? err}` }],
      changes: [],
    };
  }

  const parsed = parseJson(raw);
  const violations = validateEdit(slide, parsed);
  if (violations.length > 0) {
    return { ok: false, violations, changes: [] };
  }

  // AI has freedom to restructure — use its output directly
  const cand = parsed as SlideSpec;
  const merged: SlideSpec = {
    ...slide,
    section: cand.section ?? slide.section,
    elements: cand.elements ?? slide.elements,
  };

  return { ok: true, slide: merged, violations: [], changes: describeChanges(slide, merged) };
}
