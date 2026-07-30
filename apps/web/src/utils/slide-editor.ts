/**
 * Constrained natural-language slide editing.
 *
 * The AI is allowed to rephrase titles, reorder bullets, tighten wording and
 * switch layout hints. It is NOT allowed to change any quantitative value,
 * ranking, or period, nor to drop a source annotation. Rather than trusting
 * the model to behave, every proposed edit is diffed against the original and
 * rejected if it touches protected content.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { SlideSpec, SlideElement } from '../types/slide-spec';

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY || '';

export interface EditViolation {
  code: 'NUMBER_CHANGED' | 'RANK_CHANGED' | 'SOURCE_REMOVED' | 'CHART_REBOUND'
      | 'ELEMENT_TYPE_CHANGED' | 'DATA_ELEMENT_REMOVED' | 'INVALID_SHAPE';
  message: string;
}

export interface EditResult {
  ok: boolean;
  /** Present when ok; the edited slide. */
  slide?: SlideSpec;
  /** Why the edit was refused, or warnings about what was ignored. */
  violations: EditViolation[];
  /** Short description of what actually changed. */
  changes: string[];
}

const SYSTEM_PROMPT = `你是簡報編輯助理，負責依指示修改單一投影片的 JSON 規格。

嚴格規則（違反會被系統擋下）：
1. 絕對不可更改任何數字：value、rank、metrics 的數值、entities 的數值、表格中的數字都必須逐字保留
2. 不可刪除 type 為 "chart"、"kpi_block"、"comparison"、"table"、"source" 的元素
3. 不可更改 chart 元素的 dataKey 或 chartType
4. 不可更改任何元素的 type
5. elements 陣列的長度必須保持不變

你可以做的：
- 改寫 title、subtitle、heading、text_block、insight 的文字敘述
- 改寫或重新排序 bullet_list 的 items 文字
- 修正錯字、調整語氣、讓敘述更精簡或更專業
- 修改 section 名稱

只回傳修改後的完整 JSON 物件，不要有其他文字或 markdown 標記。`;

/** Pulls every number out of a value, used to prove numbers were preserved. */
function extractNumbers(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') {
      out.push(v);
    } else if (typeof v === 'string') {
      const found = v.match(/-?\d+(?:\.\d+)?/g);
      if (found) out.push(...found.map(Number));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out.sort((a, b) => a - b);
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => Math.abs(n - b[i]) < 1e-9);
}

const PROTECTED_TYPES = new Set(['chart', 'kpi_block', 'comparison', 'table', 'source']);

/**
 * Validates a proposed slide against the original, returning any violations.
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

  if (cand.elements.length !== original.elements.length) {
    v.push({
      code: 'DATA_ELEMENT_REMOVED',
      message: `元素數量從 ${original.elements.length} 變成 ${cand.elements.length}，不允許增減元素`,
    });
    return v;
  }

  for (let i = 0; i < original.elements.length; i++) {
    const before = original.elements[i];
    const after = cand.elements[i] as SlideElement;
    const label = `第 ${i + 1} 個元素（${before.type}）`;

    if (before.type !== after?.type) {
      v.push({
        code: 'ELEMENT_TYPE_CHANGED',
        message: `${label} 的類型被改成 ${after?.type ?? '未知'}`,
      });
      continue;
    }

    // Numbers must survive untouched everywhere they carry meaning.
    if (PROTECTED_TYPES.has(before.type) || before.type === 'text_block'
        || before.type === 'insight' || before.type === 'bullet_list'
        || before.type === 'heading' || before.type === 'title'
        || before.type === 'subtitle') {
      const nBefore = extractNumbers(stripNarrative(before));
      const nAfter = extractNumbers(stripNarrative(after));
      if (!sameNumbers(nBefore, nAfter)) {
        v.push({
          code: 'NUMBER_CHANGED',
          message: `${label} 的數值被改動（原本 ${nBefore.join('、') || '無'} → 變成 ${nAfter.join('、') || '無'}）`,
        });
      }
    }

    if (before.type === 'chart') {
      if (before.dataKey !== after.dataKey) {
        v.push({ code: 'CHART_REBOUND', message: `${label} 的資料來源 dataKey 被更改` });
      }
      if (before.chartType !== after.chartType) {
        v.push({ code: 'CHART_REBOUND', message: `${label} 的圖表類型被更改` });
      }
    }

    if (before.type === 'kpi_block') {
      const rb = (before.metrics ?? []).map(m => m.rank ?? null);
      const ra = (after.metrics ?? []).map(m => m.rank ?? null);
      if (JSON.stringify(rb) !== JSON.stringify(ra)) {
        v.push({ code: 'RANK_CHANGED', message: `${label} 的排名被更改` });
      }
    }

    if (before.type === 'source' && !after.content?.trim()) {
      v.push({ code: 'SOURCE_REMOVED', message: `${label} 的來源標註被清空` });
    }
  }

  return v;
}

/** For narrative types, numbers live in the text; for data types, in the fields. */
function stripNarrative(el: SlideElement): unknown {
  if (el.type === 'bullet_list') return el.items ?? [];
  if (el.type === 'kpi_block') return el.metrics ?? [];
  if (el.type === 'comparison') return el.entities ?? [];
  if (el.type === 'table') return el.rows ?? [];
  if (el.type === 'chart') return [];
  return el.content ?? '';
}

/** Human-readable diff of what the edit actually altered. */
function describeChanges(original: SlideSpec, edited: SlideSpec): string[] {
  const out: string[] = [];
  if (original.section !== edited.section) {
    out.push(`段落名稱：${original.section ?? '無'} → ${edited.section ?? '無'}`);
  }
  for (let i = 0; i < original.elements.length; i++) {
    const a = original.elements[i];
    const b = edited.elements[i];
    if (a.type === 'bullet_list') {
      const ja = JSON.stringify(a.items ?? []);
      const jb = JSON.stringify(b.items ?? []);
      if (ja !== jb) out.push(`要點列表已改寫（${(b.items ?? []).length} 條）`);
    } else if (a.content !== b.content && (a.content || b.content)) {
      out.push(`${a.type}：「${truncate(a.content)}」→「${truncate(b.content)}」`);
    }
  }
  return out;
}

function truncate(s?: string, n = 24): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
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

/**
 * Applies a natural-language instruction to one slide.
 * Returns the edited slide only if it passes every guardrail.
 */
export async function editSlide(
  slide: SlideSpec,
  instruction: string,
): Promise<EditResult> {
  if (!GROQ_KEY) {
    return {
      ok: false,
      violations: [{ code: 'INVALID_SHAPE', message: '尚未設定 AI 金鑰，無法執行語意編輯' }],
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
      setTimeout(() => rej(new Error('AI 回應逾時')), 30000),
    );
    const call = callGroqWithRetry(GROQ_KEY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.25,
      max_tokens: 2000,
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

  // Rebuild from the original so protected fields can never drift, taking only
  // the narrative fields from the AI response.
  const cand = parsed as SlideSpec;
  const merged: SlideSpec = {
    ...slide,
    section: cand.section ?? slide.section,
    elements: slide.elements.map((before, i) => {
      const after = cand.elements[i];
      const next: SlideElement = { ...before };
      if (before.type === 'bullet_list') {
        if (Array.isArray(after.items)) next.items = after.items;
      } else if (!PROTECTED_TYPES.has(before.type) || before.type === 'source') {
        if (typeof after.content === 'string') next.content = after.content;
      }
      return next;
    }),
  };

  return { ok: true, slide: merged, violations: [], changes: describeChanges(slide, merged) };
}
