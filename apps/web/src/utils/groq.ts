/**
 * AI plan generation — calls LLM to analyze user prompt
 * and generate an analysis plan based on actual report content.
 */

import { callGroqWithRetry, extractContent } from './groq-retry';

const GROQ_API_KEY = import.meta.env.VITE_OPENCODE_KEY || import.meta.env.VITE_GROQ_KEY || '';

export interface AIPlan {
  formulas: { id: string; name: string; definition: string; supported: boolean; reason?: string }[];
  unsupported: { name: string; reason: string }[];
  assumptions: string[];
  suggestedSlides: string[];
}

/**
 * Call AI to analyze user prompt + actual report structure
 * and generate an analysis plan.
 */
export async function generatePlanWithAI(
  prompt: string,
  fileNames: string[],
  excelSummary?: string,
): Promise<AIPlan> {
  const systemPrompt = `你是專業的數據分析顧問。使用者上傳了報表資料，你需要分析資料結構並規劃完整的分析方案。

## 你的角色
- 資深數據分析師
- 熟悉各類報表與統計格式
- 目標：為決策者製作精準的數據分析報告

## 你的任務
根據報表的實際工作表結構和欄位，產生分析計劃 JSON：
1. formulas: 可計算的所有指標（包括 id、名稱、公式定義）
2. unsupported: 因缺少資料而無法計算的指標（含原因）
3. assumptions: 分析假設（期間格式、金額單位、分母定義等）
4. suggestedSlides: 建議的簡報頁面標題（依內容量決定頁數）

## 規則
1. 只建議能從現有資料計算的指標，不可臆測不存在的欄位
2. 如果資料僅有單一期間，期間比較（如 YoY）必須標記為 unsupported
3. 如果有多期間欄位，可計算期間變化率
4. 如果有多個項目且含合計列，可計算各項目的佔比與排名
5. formulas 根據實際資料欄位推導，AI 自行判斷合適的分析指標
6. suggestedSlides 要有封面、段落分隔、圖表頁、洞察頁、結論頁
7. 回傳純 JSON，不要有 markdown 標記或其他文字

## JSON 格式
{
  "formulas": [{"id":"f1","name":"（依資料決定）","definition":"（依欄位決定公式）","supported":true}],
  "unsupported": [{"name":"年增率(YoY)","reason":"資料僅含單一年度，缺少去年同期資料"}],
  "assumptions": ["（依資料格式自動判斷）"],
  "suggestedSlides": ["封面","（依分析內容決定）","結論與建議"]
}`;

  let userMsg = `使用者上傳了 ${fileNames.length} 份報表檔案。\n\n`;
  
  if (excelSummary) {
    userMsg += `📊 報表結構：\n${excelSummary}\n\n`;
  } else {
    userMsg += `檔案：${fileNames.join(', ')}\n\n`;
  }
  
  userMsg += `📝 使用者需求：${prompt}\n\n請根據以上報表結構和使用者需求，規劃分析計劃。回傳 JSON。`;

  const data = await callGroqWithRetry(GROQ_API_KEY, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.2,
    max_tokens: 8000,
  });

  const content = extractContent(data);
  const plan = parseJSON(content);

  // ─── Validation pass: ask AI to verify the plan makes sense ───
  try {
    const valData = await callGroqWithRetry(GROQ_API_KEY, {
      messages: [
        { role: 'system', content: `你是一位資料分析品質審核員。檢查以下分析計劃是否合理：
1. formulas 的公式定義是否正確（佔比=個別/合計×100, 成長率=(本期-前期)/前期×100）
2. 是否有不存在的欄位被使用
3. unsupported 的理由是否合理
4. suggestedSlides 是否涵蓋重要面向

如果有錯誤，回傳修正後的完整 JSON（同格式）。如果正確，回傳原始 JSON 不做更改。
只回傳 JSON，不要其他文字。` },
        { role: 'user', content: `以下是使用者實際上傳的資料欄位（從報表結構摘要自動帶入）：

待檢查的計劃：
${JSON.stringify(plan, null, 1)}` },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    });
    const valContent = extractContent(valData);
    const validated = parseJSON(valContent);
    // Only use validated if it parsed and has content
    if (validated.formulas.length > 0) {
      return validated;
    }
  } catch (e) {
    console.warn('[Plan] Validation pass failed, using original:', e);
  }

  return plan;
}

function parseJSON(text: string): AIPlan {
  let cleaned = text.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    cleaned = lines.filter(l => !l.trim().startsWith('```')).join('\n');
  }
  // Find JSON
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end);
  }

  try {
    const obj = JSON.parse(cleaned);
    return {
      formulas: obj.formulas || [],
      unsupported: obj.unsupported || [],
      assumptions: obj.assumptions || [],
      suggestedSlides: obj.suggestedSlides || obj.suggested_slides || [],
    };
  } catch {
    // Fallback if parse fails
    return {
      formulas: [
        { id: 'f1', name: '（AI 將根據資料自動產生）', definition: '待分析', supported: true },
      ],
      unsupported: [],
      assumptions: ['依據資料實際欄位判斷'],
      suggestedSlides: ['封面', '數據分析', '結論'],
    };
  }
}
