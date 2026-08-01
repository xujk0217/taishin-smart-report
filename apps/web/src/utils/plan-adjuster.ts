/**
 * Plan adjustment via AI.
 * User gives a natural-language instruction, AI returns a modified plan.
 */
import { callGroqWithRetry, extractContent } from './groq-retry';
import type { AnalysisPlan } from '../types';

const KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

const SYSTEM = `你是分析計劃調整助理。使用者會告訴你想怎麼修改目前的分析計劃。

你必須回傳修改後的完整 JSON。formulas 與 suggestedSlides 要包含所有項目（含沒被修改的），
不可用省略號代替。

輸出範例（格式示範）：
{
  "formulas": [
    { "id": "f1", "name": "指標A分析", "definition": "依據資料欄位 ÷ 合計 × 100%", "supported": true },
    { "id": "f2", "name": "期間變化率", "definition": "(本期 - 上期) ÷ 上期 × 100%", "supported": true }
  ],
  "suggestedSlides": ["封面", "目錄", "趨勢分析", "比較分析", "結論與建議", "封底"],
  "explanation": "已新增比較分析頁，並調整頁面順序"
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
