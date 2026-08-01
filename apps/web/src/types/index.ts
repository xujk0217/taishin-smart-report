export type AppStage =
  | 'upload'        // 使用者上傳報表 + 輸入需求（文字/語音）
  | 'analyzing'     // AI 解析報表結構，辨識關聯與指標
  | 'plan'          // 顯示分析計劃給使用者確認
  | 'processing'    // 確定性計算 + AI 簡報生成
  | 'preview'       // 預覽簡報 + 自然語言編輯
  | 'exporting'     // 輸出 PPTX + 對應 Excel
  | 'sending';      // 自動寄送至收件人

export interface FormulaPlanItem {
  id: string;
  name: string;
  definition: string;
  supported: boolean;
  reason?: string;
}

export interface AnalysisPlan {
  formulas: FormulaPlanItem[];
  unsupported: { name: string; reason: string }[];
  assumptions: string[];
  suggestedSlides: string[];
  insights?: { topic: string; keyFinding: string; implication: string; recommendation: string }[];
}

export interface Claim {
  id: string;
  statement: string;
  source: string;
  evidenceId: string;
  editable?: boolean;
}

export interface SlideData {
  index: number;
  title: string;
  type: 'cover' | 'chart' | 'table' | 'text' | 'insight';
  content: string;
  claims: Claim[];
  chartData?: {
    chartId?: string;
    title: string;
    type: 'line' | 'bar';
    categories?: string[];
    series?: { name: string; data: number[]; color?: string }[];
    metricIds?: string[];
  };
}
