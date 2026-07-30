import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { AppStage, AnalysisPlan } from './types';
import type { SlideSpec } from './types/slide-spec';
import { UploadStage } from './components/UploadStage';
import { AnalyzingStage } from './components/AnalyzingStage';
import { PlanStage } from './components/PlanStage';
import { ProcessingStage } from './components/ProcessingStage';
import { PreviewStage } from './components/PreviewStage';
import { SendStage } from './components/SendStage';
import { generatePlanWithAI } from './utils/groq';
import { readAllExcelFiles, summariesToText, type FileSummary } from './utils/excel-reader';
import { computeMetrics, type ComputeResult } from './utils/metric-engine';
import { generateSlideSpec } from './utils/ai-slide-generator';
import { isMonthlyFileSet, mergeMonthlyFiles } from './utils/multi-file-merger';

const STEPS: { key: AppStage; label: string }[] = [
  { key: 'upload', label: '① 上傳' },
  { key: 'analyzing', label: '② AI 分析' },
  { key: 'plan', label: '③ 確認計劃' },
  { key: 'processing', label: '④ 執行' },
  { key: 'preview', label: '⑤ 預覽編輯' },
  { key: 'exporting', label: '⑥ 輸出' },
  { key: 'sending', label: '⑦ 寄送' },
];

function App() {
  const [stage, setStage] = useState<AppStage>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<AnalysisPlan | null>(null);
  const [slideSpecs, setSlideSpecs] = useState<SlideSpec[]>([]);
  const [progress, setProgress] = useState(0);
  const fileSummariesRef = useRef<FileSummary[]>([]);
  const computeResultRef = useRef<ComputeResult | null>(null);
  const excelSummaryRef = useRef<string>('');

  // ─── Browser history management (fix back button) ──────────
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const savedStage = e.state?.stage;
      if (savedStage && savedStage !== stage) {
        setStage(savedStage);
      } else {
        // Default: go back to upload
        setStage('upload');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [stage]);

  // Push state when stage changes
  useEffect(() => {
    if (stage !== 'upload') {
      window.history.pushState({ stage }, '', `#${stage}`);
    }
  }, [stage]);

  const handleUploadComplete = useCallback((uploadedFiles: File[], userPrompt: string) => {
    setFiles(uploadedFiles);
    setPrompt(userPrompt);
    setStage('analyzing');
    
    // 1. Read Excel files in browser to get structure
    // 2. Send structure + prompt to AI for plan generation
    const fileNames = uploadedFiles.map(f => f.name);
    
    readAllExcelFiles(uploadedFiles)
      .then(summaries => {
        // Check if files are monthly and need merging
        let processedSummaries = summaries;
        if (isMonthlyFileSet(summaries)) {
          console.log('[App] Detected monthly file set, merging...');
          processedSummaries = mergeMonthlyFiles(summaries);
        }
        fileSummariesRef.current = processedSummaries;
        const summaryText = summariesToText(processedSummaries);
        excelSummaryRef.current = summaryText;
        console.log('Excel summary for AI:', summaryText);
        return generatePlanWithAI(userPrompt, fileNames, summaryText);
      })
      .then(aiPlan => {
        setPlan(aiPlan);
        setStage('plan');
      })
      .catch(err => {
        console.error('AI plan generation failed:', err);
        // Show error to user, don't silently use mock
        const useMock = confirm(
          `AI 分析暫時無法使用（${err?.message?.slice(0, 60) ?? '連線逾時'}）。\n\n按「確定」使用範例計劃繼續，按「取消」返回重試。`
        );
        if (useMock) {
          setPlan(generateMockPlan(userPrompt));
          setStage('plan');
        } else {
          setStage('upload');
        }
      });
  }, []);

  const handlePlanApproved = useCallback((updatedPlan: AnalysisPlan) => {
    setPlan(updatedPlan);
    setStage('processing');
    setProgress(0);

    (async () => {
      try {
        setProgress(20);
        await new Promise(r => setTimeout(r, 300));

        // Step 1: Compute metrics
        setProgress(40);
        const result = computeMetrics(fileSummariesRef.current);
        computeResultRef.current = result;
        console.log('[App] Metrics computed:', result.summary);

        // Step 2: Generate detailed slide spec via AI
        setProgress(60);
        const spec = await generateSlideSpec(prompt, result, excelSummaryRef.current);
        console.log('[App] Slide spec generated:', spec.metadata);

        setProgress(90);
        setSlideSpecs(spec.slides);
        await new Promise(r => setTimeout(r, 300));

        setProgress(100);
        setStage('preview');
      } catch (err: any) {
        console.error('[App] Processing failed:', err);
        const useFallback = confirm(
          `AI 簡報規劃失敗（${err?.message?.slice(0, 60) ?? '逾時'}）。\n\n按「確定」使用範例簡報，按「取消」返回計劃頁。`
        );
        if (useFallback) {
          setStage('preview');
        } else {
          setStage('plan');
        }
      }
    })();
  }, [prompt]);

  const handleExport = useCallback(() => {
    if (slideSpecs.length === 0) {
      alert('沒有可匯出的投影片');
      return;
    }
    setStage('exporting');
    import('./utils/pptx-exporter')
      .then(({ exportPptx }) => exportPptx(slideSpecs, computeResultRef.current))
      .then(() => setStage('preview'))
      .catch(err => {
        console.error('[App] PPTX export failed:', err);
        alert('匯出失敗：' + (err?.message ?? String(err)));
        setStage('preview');
      });
  }, [slideSpecs]);

  const getStepStatus = (stepKey: AppStage) => {
    const order = STEPS.map(s => s.key);
    const currentIdx = order.indexOf(stage);
    const stepIdx = order.indexOf(stepKey);
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'active';
    return '';
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>智匯數據簡報神器</h1>
          <div className="subtitle">台新新光金控 AI 報表轉簡報系統</div>
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
          Powered by Groq + LLama 3.1
        </div>
      </header>

      <main className={`main${stage === 'preview' || stage === 'exporting' || stage === 'sending' ? ' main-wide' : ''}`}>
        {/* Step indicator */}
        <div className="steps">
          {STEPS.map(s => (
            <div key={s.key} className={`step ${getStepStatus(s.key)}`}>
              {s.label}
            </div>
          ))}
        </div>

        {/* Stage content */}
        {stage === 'upload' && (
          <UploadStage onComplete={handleUploadComplete} />
        )}
        {stage === 'analyzing' && (
          <AnalyzingStage prompt={prompt} />
        )}
        {stage === 'plan' && plan && (
          <PlanStage plan={plan} onApprove={handlePlanApproved} onBack={() => setStage('upload')} />
        )}
        {stage === 'processing' && (
          <ProcessingStage progress={progress} />
        )}
        {(stage === 'preview' || stage === 'exporting') && (
          <PreviewStage
            slides={slideSpecs}
            computeResult={computeResultRef.current}
            onExport={handleExport}
            exporting={stage === 'exporting'}
            onSlideChange={(index, slide) =>
              setSlideSpecs(prev => prev.map((s, i) => (i === index ? slide : s)))
            }
            onSend={() => setStage('sending')}
          />
        )}
        {stage === 'sending' && (
          <SendStage
            slideCount={slideSpecs.length}
            onBack={() => setStage('preview')}
            onDone={() => setStage('upload')}
          />
        )}
      </main>
    </div>
  );
}

// ─── Mock Data Generators (fallback) ──────────────────────────

function generateMockPlan(prompt: string): AnalysisPlan {
  return {
    formulas: [
      { id: 'f1', name: '簽帳金額市占率', definition: 'entity_amount / total_amount × 100', supported: true },
      { id: 'f2', name: '流通卡數市占率', definition: 'entity_cards / total_cards × 100', supported: true },
      { id: 'f3', name: '月增率 (MoM)', definition: '(current - previous) / previous × 100', supported: true },
      { id: 'f4', name: '有效卡率', definition: 'active_cards / total_cards × 100', supported: true },
      { id: 'f5', name: '單卡平均簽帳金額', definition: 'total_amount / active_cards', supported: true },
      { id: 'f6', name: '排名', definition: '各銀行依數值由大至小排列', supported: true },
    ],
    unsupported: [
      { name: '年增率 (YoY)', reason: '缺少 113 年同期資料，無法計算年增率' },
    ],
    assumptions: [
      '期間格式為民國年月（11401 = 114年1月）',
      '金額單位為新台幣百萬元',
      '市占率以全體銀行為分母計算',
      '排名依數值由大至小排列',
    ],
    suggestedSlides: [
      '封面：台新信用卡年度市場分析',
      '市占率趨勢圖（折線圖）',
      '簽帳金額排名（柱狀圖）',
      '月增率變化（折線圖）',
      '有效卡率比較（柱狀圖）',
      '競爭分析洞察',
      '結論與策略建議',
    ],
  };
}
export default App;
