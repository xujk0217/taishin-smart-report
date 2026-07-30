/**
 * Plan adjustment via AI.
 * User gives a natural-language instruction, AI returns a modified plan.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { AnalysisPlan } from '../types';

const KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

const SYSTEM = `你是台新金控的分析計劃調整助理。使用者會告訴你想怎麼修改目前的分析計劃。

你必須回傳修改後的完整 JSON（跟輸入格式一樣）：
{
  "formulas": [...],
  "suggestedSlides": [...],
  "explanation": "說明你做了什麼修改（1-2句話）"
}

規則：
1. 使用者說「加」→ 新增指標或投影片
2. 使用者說「移除/刪除」→ 移除對應項目
3. 使用者說「把XX改成YY」→ 修改名稱或定義
4. 使用者說「重新排序」→ 調整順序
5. 保留沒被提到的項目不變
6. formulas 的 id 要唯一（f1, f2, ...）
7. 回傳純 JSON，不要 markdown`;

export interface AdjustResult {
  ok: boolean;
  formulas?: AnalysisPlan['formulas'];
  slides?: string[];
  explanation: string;
}

export async function adjustPlanWithAI(
  currentFormulas: AnalysisPlan['formulas'],
  currentSlides: string[],
  instruction: string,
): Promise<AdjustResult> {
  if (!KEY) {
    return { ok: false, explanation: '未設定 AI 金鑰' };
  }

  const userMsg = `目前的計算指標：
${JSON.stringify(currentFormulas, null, 1)}

目前的投影片：
${JSON.stringify(currentSlides)}

使用者要求：${instruction}

請回傳修改後的完整 JSON。`;

  try {
    const data = await callGroqWithRetry(KEY, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });

    const content = extractContent(data);
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) cleaned = cleaned.split('\n').filter(l => !l.startsWith('```')).join('\n');
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}') + 1;
    if (s >= 0 && e > s) cleaned = cleaned.slice(s, e);

    const result = JSON.parse(cleaned);
    return {
      ok: true,
      formulas: result.formulas ?? currentFormulas,
      slides: result.suggestedSlides ?? result.slides ?? currentSlides,
      explanation: result.explanation ?? '已調整計劃',
    };
  } catch (err: any) {
    return { ok: false, explanation: `AI 調整失敗：${err?.message ?? err}` };
  }
}
