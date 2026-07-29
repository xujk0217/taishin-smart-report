/**
 * Groq API client - calls Llama 3.1 8B to analyze user prompt
 * and generate an analysis plan based on actual Excel content.
 */

import { callGroqWithRetry, extractContent } from './groq-retry';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY || '';

export interface AIPlan {
  formulas: { id: string; name: string; definition: string; supported: boolean; reason?: string }[];
  unsupported: { name: string; reason: string }[];
  assumptions: string[];
  suggestedSlides: string[];
}

/**
 * Call Groq AI to analyze user prompt + actual Excel structure
 * and generate an analysis plan.
 */
export async function generatePlanWithAI(
  prompt: string,
  fileNames: string[],
  excelSummary?: string,
): Promise<AIPlan> {
  const systemPrompt = `你是一位台灣金融數據分析 AI 助理。使用者上傳了信用卡統計 Excel 檔案並告訴你分析需求。
你需要根據實際的 Excel 工作表結構和欄位，規劃要計算哪些指標、產生幾頁投影片。

規則：
1. 只建議能從現有資料計算的指標
2. 如果需要年增率(YoY)但資料只有單一年度，標記為 unsupported 並說明原因
3. 如果欄位有「月份」或民國年月格式（如 11401），可以計算月增率(MoM)
4. 如果有多家銀行的數值，可以計算市占率和排名
5. 根據資料量和複雜度，建議合適的投影片數量（通常 5-10 頁）
6. 回傳純 JSON，不要有其他文字或 markdown

JSON 格式：
{
  "formulas": [{"id":"f1","name":"指標名稱","definition":"公式或計算方式說明","supported":true}],
  "unsupported": [{"name":"指標名稱","reason":"為何無法計算的原因"}],
  "assumptions": ["計算假設1","計算假設2"],
  "suggestedSlides": ["投影片1：標題","投影片2：標題"]
}`;

  let userMsg = `使用者上傳了 ${fileNames.length} 份 Excel 檔案。\n\n`;
  
  if (excelSummary) {
    userMsg += `📊 Excel 檔案結構：\n${excelSummary}\n\n`;
  } else {
    userMsg += `檔案：${fileNames.join(', ')}\n\n`;
  }
  
  userMsg += `📝 使用者需求：${prompt}\n\n請根據以上 Excel 結構和使用者需求，規劃分析計劃。回傳 JSON。`;

  const data = await callGroqWithRetry(GROQ_API_KEY, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  });

  const content = extractContent(data);
  return parseJSON(content);
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
        { id: 'f1', name: '市占率', definition: 'entity / total × 100', supported: true },
        { id: 'f2', name: '排名', definition: '依數值大小排列', supported: true },
      ],
      unsupported: [],
      assumptions: ['民國年月格式', '金額單位百萬元'],
      suggestedSlides: ['封面', '市占率分析', '排名比較', '結論'],
    };
  }
}
