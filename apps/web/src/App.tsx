import { useEffect, useMemo, useState } from 'react';
import { beginSignIn, completeSignIn, signOut, type DisplayIdentity } from './auth';
import { MockJobClient } from './clients/mock-job-client';
import { AwsPlannerClient } from './clients/aws-planner-client';
import { isCognitoConfigured, isRealPlannerConfigured } from './runtime-config';
import type { JobSnapshot } from './types/job';
import type { PlannerJobResponse } from '@smart-report/contracts';

type StageKey = 'upload' | 'analysis' | 'plan' | 'execute' | 'preview' | 'output' | 'send';

const STAGES: Array<{ key: StageKey; number: string; label: string; role: string }> = [
  { key: 'upload', number: '①', label: '上傳', role: '輸入檔案與 Prompt' },
  { key: 'analysis', number: '②', label: 'AI 分析', role: 'Lobster 理解要求' },
  { key: 'plan', number: '③', label: '確認計劃', role: '可問 AI 編輯' },
  { key: 'execute', number: '④', label: '執行', role: 'Agent 使用工具' },
  { key: 'preview', number: '⑤', label: '預覽編輯', role: '可問 AI 編輯' },
  { key: 'output', number: '⑥', label: '輸出', role: '建立交付產物' },
  { key: 'send', number: '⑦', label: '寄送', role: '寄送與稽核' },
];

const mockClient = new MockJobClient();
const awsPlanner = new AwsPlannerClient();

function App() {
  const [identity, setIdentity] = useState<DisplayIdentity | null>(null);
  const [stage, setStage] = useState<StageKey>('upload');
  const [maxStage, setMaxStage] = useState(0);
  const [prompt, setPrompt] = useState('請根據我提供的資料，找出重要趨勢與異常，必要時研究適用公式，並產生給主管看的決策簡報。');
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [realPlan, setRealPlan] = useState<PlannerJobResponse | null>(null);
  const [planJson, setPlanJson] = useState('');
  const [planInstruction, setPlanInstruction] = useState('');
  const [planRevisions, setPlanRevisions] = useState<string[]>([]);
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [previewInstruction, setPreviewInstruction] = useState('');
  const [previewRevisions, setPreviewRevisions] = useState<string[]>([]);
  const [outputReady, setOutputReady] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    completeSignIn().then(setIdentity).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    });
  }, []);

  useEffect(() => {
    if (!realPlan || !['QUEUED', 'RUNNING', 'REVISION_QUEUED'].includes(realPlan.status)) return;
    const timer = window.setTimeout(() => {
      awsPlanner.get(realPlan.jobId).then(updated => {
        setRealPlan(updated);
        if (updated.planningOutput) setPlanJson(JSON.stringify(updated.planningOutput, null, 2));
      }).catch(reason => setError(reason instanceof Error ? reason.message : '無法更新 Planner 狀態'));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [realPlan]);

  const stageIndex = STAGES.findIndex((item) => item.key === stage);
  const completedExecution = useMemo(
    () => job?.stages.filter((item) => item.status === 'COMPLETED').length ?? 0,
    [job],
  );

  function moveTo(next: StageKey) {
    const index = STAGES.findIndex((item) => item.key === next);
    setStage(next);
    setMaxStage((current) => Math.max(current, index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function startAnalysis() {
    if (!prompt.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (isRealPlannerConfigured()) {
        if (!identity) throw new Error('請先使用 Cognito 登入');
        if (files.length < 1) throw new Error('請至少選擇一個 Excel 檔案');
        const created = await awsPlanner.create(files, prompt.trim());
        setRealPlan(created);
        setPlanJson('');
        moveTo('analysis');
        return;
      }
      const created = await mockClient.createJob({
        topic: prompt.trim(),
        audience: '由 Lobster 從 Prompt 判斷',
        style: '由 Lobster 從 Prompt 判斷',
        localFiles: files.map(file => ({ name: file.name, size: file.size })),
      });
      setJob(created);
      setSelectedSlide(0);
      moveTo('analysis');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法建立 Mock Job');
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan() {
    setBusy(true);
    try {
      if (realPlan?.planningOutput) {
        const approved = await awsPlanner.approve(realPlan.jobId, realPlan.planVersion);
        setRealPlan(approved);
        const mock = await mockClient.createJob({ topic: prompt.trim(), audience: 'Stage ④ Mock', style: 'Stage ④ Mock', localFiles: files.map(file => ({ name: file.name, size: file.size })) });
        setJob(await mockClient.approvePlan(mock.jobId));
      } else if (job) {
        setJob(await mockClient.approvePlan(job.jobId));
      } else return;
      moveTo('execute');
    } finally {
      setBusy(false);
    }
  }

  async function advanceExecution() {
    if (!job) return;
    setBusy(true);
    try {
      const updated = await mockClient.advance(job.jobId);
      setJob(updated);
      if (!updated.stages.some((item) => item.status === 'RUNNING')) moveTo('preview');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage('upload'); setMaxStage(0); setJob(null); setRealPlan(null); setPlanJson(''); setFiles([]);
    setPlanRevisions([]); setPreviewRevisions([]); setOutputReady(false); setSent(false); setRecipient('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">L</span><div><strong>Lobster Studio</strong><small>Prompt-driven report agent</small></div></div>
        <div className="top-actions">
          <span className="environment"><i />UI-1 · Workshop</span>
          <span className={`badge ${isRealPlannerConfigured() ? 'real' : 'mock'}`}>{isRealPlannerConfigured() ? 'STAGE ② REAL' : 'MOCK'}</span>
          {identity ? <button className="button secondary" onClick={signOut}>{identity.email} · 登出</button> : <button className="button primary small" disabled={!isCognitoConfigured()} onClick={() => beginSignIn()}>Cognito 登入</button>}
        </div>
      </header>

      <main className="seven-stage-shell">
        <section className="stage-rail" aria-label="七階段工作流">
          {STAGES.map((item, index) => (
            <button
              key={item.key}
              className={`stage-tab ${index === stageIndex ? 'active' : ''} ${index < stageIndex ? 'done' : ''}`}
              disabled={index > maxStage}
              onClick={() => index <= maxStage && setStage(item.key)}
            >
              <span>{item.number}</span><strong>{item.label}</strong><small>{item.role}</small>
            </button>
          ))}
        </section>

        <div className="stage-heading">
          <div><span className="eyebrow">{STAGES[stageIndex].role}</span><h1>{STAGES[stageIndex].number} {STAGES[stageIndex].label}</h1></div>
          <div className="stage-meta"><span>Job</span><strong>{realPlan?.jobId ?? job?.jobId ?? '尚未建立'}</strong><small>{isRealPlannerConfigured() ? 'Excel + Prompt + Planner REAL · Stage ④+ MOCK' : 'UI fixture only'}</small></div>
        </div>

        {error && <div className="notice warning">{error}</div>}

        {stage === 'upload' && <section className="stage-card upload-stage-card">
          <div className="intro-copy"><span className="eyebrow">One prompt, adaptive workflow</span><h2>把你想做的事情直接告訴龍蝦。</h2><p>不用填受眾、公式或簡報格式表格。Lobster 會從 Prompt 判斷目標、限制、資料需求、研究方式、Skill 與輸出規格，再交給你確認。</p></div>
          <label className="prompt-box"><span>任務 Prompt</span><textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：比較三種方案，找出適用公式與公開資料，做成給主管看的 10 頁決策簡報..." /><small>目前只進行 mock 分析，不會送到模型或外部服務。</small></label>
          <label className="file-picker large"><input type="file" accept=".xlsx" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 20))} /><strong>選擇 Excel 檔案（最多 20 個）</strong><span>{isRealPlannerConfigured() ? '檔案會加密上傳至 AWS，24 小時後刪除' : 'Mock 模式不會上傳'}</span></label>
          {files.length > 0 && <div className="file-chips">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span>)}</div>}
          <button className="button primary stage-action" disabled={busy || !prompt.trim()} onClick={startAnalysis}>{busy ? '上傳與建立中...' : isRealPlannerConfigured() ? '上傳並開始真實 AI 分析 →' : '開啟非推論規劃範例 →'}</button>
        </section>}

        {stage === 'analysis' && realPlan && <section className="stage-card">
          <div className="agent-working"><div className="agent-orb">L</div><div><span className="badge real">REAL AWS PLANNER</span><h2>{realPlan.status === 'NEEDS_REVIEW' ? '真實計畫已完成' : realPlan.status === 'FAILED' ? '規劃失敗' : 'Fargate Agent 正在讀取 Excel 並建立計畫'}</h2><p>狀態：{realPlan.status} · Plan version {realPlan.planVersion}</p></div></div>
          {realPlan.safeErrorCode && <div className="notice warning">{realPlan.safeErrorCode}</div>}
          {realPlan.planningOutput && <div className="analysis-grid"><article><span>受眾</span><strong>{realPlan.planningOutput.prompt_contract.target_audience}</strong></article><article><span>頁數</span><strong>{realPlan.planningOutput.deck_plan.total_pages}</strong></article><article><span>公式</span><strong>{realPlan.planningOutput.formula_plan.formulas.length}</strong></article><article><span>計算任務</span><strong>{realPlan.planningOutput.calculation_plan.tasks.length}</strong></article><article><span>圖表</span><strong>{realPlan.planningOutput.prompt_contract.charts.length}</strong></article><article><span>來源座標</span><strong>{realPlan.sourceReferences.length}</strong></article></div>}
          {realPlan.status === 'NEEDS_REVIEW' && <button className="button primary stage-action" onClick={() => moveTo('plan')}>檢視與編輯真實計畫 →</button>}
        </section>}

        {stage === 'plan' && realPlan?.planningOutput && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">AIPlanningOutput v3 · REAL</span><h2>{realPlan.planningOutput.deck_plan.title}</h2><p>{realPlan.planningOutput.deck_plan.narrative_strategy}</p></div><span className="badge real">VERSION {realPlan.planVersion}</span></div>
          <div className="requirement-grid">{realPlan.planningOutput.formula_plan.formulas.map(formula => <article key={formula.formula_id}><strong>{formula.name}</strong><p><code>{formula.expression}</code></p><small>{formula.status} · {formula.source_candidates.map(source => `${source.source_type}/${source.verification_state}`).join('、')}</small></article>)}</div>
          <div className="deck-plan-grid">{realPlan.planningOutput.deck_plan.slides.map(slide => <article className={`deck-page-card ${slide.kind}`} key={slide.page_number}><div className="deck-page-head"><span>{String(slide.page_number).padStart(2, '0')}</span><small>{slide.kind}</small></div><h3>{slide.title}</h3><p>{slide.key_message}</p><small>{slide.layout_guidance}</small></article>)}</div>
          <label className="prompt-box"><span>完整 JSON 手動編輯</span><textarea rows={22} value={planJson} onChange={event => setPlanJson(event.target.value)} /></label>
          <div className="action-row"><button className="button secondary" disabled={busy} onClick={async () => { try { setBusy(true); const parsed = JSON.parse(planJson); const updated = await awsPlanner.manualEdit(realPlan.jobId, parsed, realPlan.planVersion); setRealPlan(updated); setPlanJson(JSON.stringify(updated.planningOutput, null, 2)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'JSON 修改失敗'); } finally { setBusy(false); } }}>儲存手動修改</button></div>
          <div className="ai-edit-box"><div><strong>用自然語言重新規劃</strong><small>會以相同 Excel、原 Prompt 與完整修改要求重新生成</small></div><input value={planInstruction} onChange={event => setPlanInstruction(event.target.value)} placeholder="例如：改成 12 頁，增加公式來源與風險頁" /><button className="button secondary" disabled={busy || !planInstruction.trim()} onClick={async () => { try { setBusy(true); const updated = await awsPlanner.revise(realPlan.jobId, planInstruction.trim(), realPlan.planVersion); setRealPlan(updated); setPlanInstruction(''); moveTo('analysis'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 修改失敗'); } finally { setBusy(false); } }}>送出 AI 修改</button></div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('analysis')}>返回分析</button><button className="button primary" disabled={busy} onClick={approvePlan}>核准此版本，Stage ④以 Mock 繼續 →</button></div>
        </section>}

        {stage === 'analysis' && job && !realPlan && <section className="stage-card">
          <div className="notice warning"><strong>AI Planner NOT_ENABLED</strong> — 下方只展示未來 schema 與畫面位置，沒有用關鍵字、if/else 或模型分析此 Prompt。</div>
          <div className="agent-working"><div className="agent-orb">L</div><div><span className="badge not-enabled">SYNTHETIC EXAMPLE</span><h2>完整 Prompt 將交給 AI 自主判斷</h2><p>AI 可輸出指標、洞察、資料、研究、公式、視覺、頁數、風格及未預期的自訂要求；程式只驗證結構與治理規則。</p></div></div>
          <div className="analysis-grid">
            <article><span>原始需求（未分析）</span><strong>{job.promptContract.userIntent.slice(0, 100)}{job.promptContract.userIntent.length > 100 ? '…' : ''}</strong></article>
            <article><span>受眾</span><strong>{job.promptContract.targetAudience}</strong></article>
            <article><span>頁數</span><strong>{job.promptContract.recommendedPageCount} 頁 UI 範例 · 非 AI 建議</strong></article>
            <article><span>風格</span><strong>{job.promptContract.toneAndStyle.join(' · ')}</strong></article>
            <article><span>資料範圍</span><strong>{files.length ? `${files.length} 個檔名已選取；內容未讀取` : '沒有讀取或上傳資料'}</strong></article>
            <article><span>治理方式</span><strong>固定五階段時機；每階段工作內容由 AI 規劃</strong></article>
          </div>
          <div className="requirement-section">
            <div className="section-title compact"><div><span className="eyebrow">Flexible AI output</span><h3>圖表與視覺需求</h3></div><small>不限制視覺形式，不使用關鍵字 mapping</small></div>
            <div className="requirement-grid">{job.promptContract.charts.map((chart) => <article key={chart.chartId}><div><span className="origin recommended">待 AI 判斷</span><strong>{chart.visualization}</strong></div><h4>{chart.title}</h4><p>{chart.purpose}</p><small>{chart.rationale}</small></article>)}</div>
          </div>
          <div className="requirement-section">
            <div className="section-title compact"><div><span className="eyebrow">Evidence-backed insights</span><h3>洞察問題</h3></div><small>AI 定義問題，取得證據後才能寫結論</small></div>
            <div className="requirement-grid insights">{job.promptContract.insights.map((insight) => <article key={insight.insightId}><span className="origin recommended">待 AI 判斷</span><h4>{insight.question}</h4><p>{insight.purpose}</p><small>{insight.evidenceNeeded.length ? `需要：${insight.evidenceNeeded.join('、')}` : '證據需求待 AI 規劃'}</small></article>)}</div>
          </div>
          <div className="guardrail-list">{job.promptContract.contentConstraints.map((item) => <span key={item}>✓ {item}</span>)}</div>
          <div className="analysis-log"><span /><p><strong>Strands schema</strong> 已定義</p><span /><p><strong>AI model</strong> NOT_ENABLED</p><span /><p><strong>五階段治理</strong> 已規範</p></div>
          <button className="button primary stage-action" onClick={() => moveTo('plan')}>查看逐頁 UI 範例 →</button>
        </section>}

        {stage === 'plan' && job && !realPlan && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">DeckPlan schema · synthetic example</span><h2>逐頁規劃介面</h2><p>{job.deckPlan.narrativeArc.join(' → ')}</p></div><span className="badge not-enabled">AI NOT_ENABLED</span></div>
          <div className="notice">此頁不代表 Prompt 的規劃結果；它只展示 real AI 將回傳的逐頁欄位與編輯流程。</div>
          <div className="deck-plan-grid">{job.deckPlan.slides.map((slide) => <article className={`deck-page-card ${slide.kind}`} key={slide.pageNumber}><div className="deck-page-head"><span>{String(slide.pageNumber).padStart(2, '0')}</span><small>{slide.kind}</small></div><h3>{slide.title}</h3><p>{slide.keyMessage}</p><div className="content-tags">{slide.contentElements.map((element) => <span key={element}>{element}</span>)}</div>{slide.chartIds.length > 0 && <dl><dt>圖表</dt><dd>{slide.chartIds.map((id) => job.promptContract.charts.find((chart) => chart.chartId === id)?.title ?? id).join('、')}</dd></dl>}{slide.insightIds.length > 0 && <dl><dt>洞察</dt><dd>{slide.insightIds.map((id) => job.promptContract.insights.find((insight) => insight.insightId === id)?.question ?? id).join('、')}</dd></dl>}<small className="page-purpose">{slide.communicationGoal}</small></article>)}</div>
          <details className="execution-plan" open><summary>五階段治理流程（內容由 AI 動態填入）</summary><div className="plan-grid">{job.executionPlan.stages.map((step, index) => <article className="plan-card" key={step.stageId}><span className="number">{String(index + 1).padStart(2, '0')}</span><h3>{step.stageClass}</h3><p>{step.objective}</p><dl><div><dt>允許工具時機</dt><dd>{step.allowedToolCategories.join('、')}</dd></div><div><dt>每階段驗證</dt><dd>{step.validationChecks.join('、')}</dd></div></dl>{step.requiresUserApproval && <span className="approval">需要核准</span>}</article>)}</div></details>
          <div className="unresolved-box"><strong>Real AI 啟用後顯示的待確認問題</strong>{job.deckPlan.unresolvedQuestions.map((question) => <span key={question}>{question}</span>)}</div>
          {planRevisions.length > 0 && <div className="revision-list">{planRevisions.map((item, index) => <p key={`${item}-${index}`}><span>Pending instruction {index + 1}</span>{item}</p>)}</div>}
          <div className="ai-edit-box"><div><strong>AI 修改入口（尚未啟用）</strong><small>未來會把完整修改要求送回模型重新產生 schema，而不是用 if/else 修改欄位</small></div><input value={planInstruction} onChange={(event) => setPlanInstruction(event.target.value)} placeholder="輸入完整修改要求..." /><button className="button secondary" disabled={!planInstruction.trim()} onClick={() => { setPlanRevisions((items) => [...items, planInstruction.trim()]); setPlanInstruction(''); }}>暫存指令</button></div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('analysis')}>返回說明</button><button className="button primary" disabled={busy} onClick={approvePlan}>模擬核准並執行 →</button></div>
        </section>}

        {stage === 'execute' && job && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">Agent runtime</span><h2>Lobster 正在依計畫使用 Skill 與工具</h2></div><div className="counter"><strong>{completedExecution}/{job.stages.length}</strong><span>stages verified</span></div></div>
          <div className="execution-layout"><div className="timeline">{job.stages.map((item) => <article className="stage" key={item.id}><i className={item.status.toLowerCase()} /><div><div><strong>{item.label}</strong><span>{item.status}</span></div><p>{item.description}</p><small>Attempt {item.attempt} · Independent Gate {item.gate ?? 'PENDING'}</small></div></article>)}</div><aside className="runtime-card"><span className="eyebrow">Current worker</span><h3>{job.stages.find((item) => item.status === 'RUNNING')?.label ?? '等待下一階段'}</h3><p>正式版會顯示 Strands agent 的 tool receipt、引用、token、重試與 Gate finding。</p><button className="button primary full" disabled={busy} onClick={advanceExecution}>完成目前 Mock 工作 →</button></aside></div>
        </section>}

        {stage === 'preview' && job && <section className="stage-card preview-stage">
          <div className="section-title"><div><span className="eyebrow">Editable plan preview</span><h2>逐頁預覽與 AI 編輯</h2></div><span className="badge mock">{job.deckPlan.slides.length} slides</span></div>
          <div className="preview-workbench"><div className="slide-list">{job.deckPlan.slides.map((slide, index) => <button className={selectedSlide === index ? 'active' : ''} key={`${slide.pageNumber}-${slide.title}`} onClick={() => setSelectedSlide(index)}><span>{slide.pageNumber}</span><strong>{slide.title}</strong></button>)}</div><div className="slide-canvas"><span>{job.deckPlan.slides[selectedSlide].kind} · page {job.deckPlan.slides[selectedSlide].pageNumber}</span><h3>{job.deckPlan.slides[selectedSlide].title}</h3><p>{job.deckPlan.slides[selectedSlide].keyMessage}</p><div className="canvas-tags">{job.deckPlan.slides[selectedSlide].contentElements.map((element) => <small key={element}>{element}</small>)}</div><small>Non-inferential UI placeholder · SYNTHETIC EXAMPLE</small></div><div className="preview-info"><span className="eyebrow">Slide intent</span><h3>第 {job.deckPlan.slides[selectedSlide].pageNumber} 頁</h3><p>{job.deckPlan.slides[selectedSlide].communicationGoal}</p>{job.deckPlan.slides[selectedSlide].chartIds.length > 0 && <small>圖表：{job.deckPlan.slides[selectedSlide].chartIds.join('、')}</small>}{job.deckPlan.slides[selectedSlide].insightIds.length > 0 && <small>洞察：{job.deckPlan.slides[selectedSlide].insightIds.join('、')}</small>}<small>{job.deckPlan.slides[selectedSlide].speakerNotesGuidance}</small>{previewRevisions.map((item, index) => <small key={`${item}-${index}`}>Revision {index + 1}: {item}</small>)}</div></div>
          <div className="ai-edit-box"><div><strong>問 AI 修改預覽</strong><small>例如：讓標題更有行動感、換圖表、合併兩頁</small></div><input value={previewInstruction} onChange={(event) => setPreviewInstruction(event.target.value)} placeholder="輸入簡報修改要求..." /><button className="button secondary" disabled={!previewInstruction.trim()} onClick={() => { setPreviewRevisions((items) => [...items, previewInstruction.trim()]); setPreviewInstruction(''); }}>記錄 Mock 修改</button></div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('plan')}>回到計畫</button><button className="button primary" onClick={() => moveTo('output')}>確認預覽並輸出 →</button></div>
        </section>}

        {stage === 'output' && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">Artifact builder</span><h2>選擇輸出產物</h2></div><span className="badge not-enabled">RENDERER NOT ENABLED</span></div>
          <div className="output-grid">{[['PPTX','原生可編輯圖表與文字'],['XLSX','計算、來源與稽核工作表'],['PDF','固定版面檢視版本']].map(([format, text]) => <article key={format}><span>{format}</span><h3>{format === 'PPTX' ? 'PowerPoint 簡報' : format === 'XLSX' ? '分析工作簿' : 'PDF 預覽'}</h3><p>{text}</p><small>MOCK placeholder</small></article>)}</div>
          {outputReady ? <div className="notice">Synthetic 產物清單已建立；沒有真實檔案被生成或下載。</div> : <button className="button primary stage-action" onClick={() => setOutputReady(true)}>模擬生成產物</button>}
          {outputReady && <div className="action-row"><button className="button secondary" onClick={() => moveTo('preview')}>返回預覽</button><button className="button primary" onClick={() => moveTo('send')}>前往寄送 →</button></div>}
        </section>}

        {stage === 'send' && <section className="stage-card send-stage">
          <span className="eyebrow">Delivery and audit</span><h2>寄送簡報</h2><p>正式版會在最終核准後，透過受控寄送服務傳送已驗證產物並保存稽核紀錄。</p>
          <label className="field"><span>收件人 Email</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.com" /></label>
          {!sent ? <button className="button primary stage-action" disabled={!recipient.includes('@')} onClick={() => setSent(true)}>模擬寄送</button> : <div className="send-success"><span>✓</span><div><strong>Mock 寄送完成</strong><p>沒有 Email 或附件被真正傳送。</p></div></div>}
          {sent && <button className="button secondary stage-action" onClick={reset}>建立新任務</button>}
        </section>}
      </main>
    </div>
  );
}

export default App;
