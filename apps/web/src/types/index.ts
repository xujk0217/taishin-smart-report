export type AppStage =
  | 'upload'        // 使用者上傳 Excel + 輸入 prompt
  | 'analyzing'     // AI 分析 prompt，決定要做什麼
  | 'plan'          // 顯示計劃給使用者確認
  | 'processing'    // 執行計算、AI 洞察
  | 'preview'       // 預覽簡報 + 編輯
  | 'exporting';    // 輸出最終 PPTX

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
