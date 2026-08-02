import { useEffect, useMemo, useState } from 'react';
import { AUTH_SESSION_CLEARED_EVENT, beginSignIn, completeSignIn, signOut, type DisplayIdentity } from './auth';
import { MockJobClient } from './clients/mock-job-client';
import { AwsPlannerClient } from './clients/aws-planner-client';
import { isCognitoConfigured, isRealPlannerConfigured } from './runtime-config';
import type { JobSnapshot } from './types/job';
import type { AIPlanningOutputDto, PlannerJobResponse, PlannerProjectSummary } from '@smart-report/contracts';

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
const ACTIVE_PLANNER_STATUSES = new Set(['QUEUED', 'RUNNING', 'REVISION_QUEUED', 'CALCULATION_QUEUED', 'CALCULATING', 'PRESENTATION_QUEUED', 'PRESENTATION_RENDERING']);
const RETRYABLE_PLANNING_ERRORS = new Set(['PLAN_OUTPUT_TOO_LARGE', 'PLAN_OUTPUT_STORAGE_LIMIT']);
const PLANNER_ERROR_MESSAGES: Record<string, string> = {
  PLAN_OUTPUT_TOO_LARGE: 'AI 規劃內容超過單次輸出容量，系統已提高各階段額度；可直接使用原檔案重新規劃。',
  PLAN_OUTPUT_STORAGE_LIMIT: '規劃內容超過專案安全儲存容量；可直接重新規劃以產生較精簡版本。',
  PLANNING_FAILED: 'AI 規劃未完成，請稍後再試。',
  PLANNER_ORCHESTRATION_FAILED: '規劃工作節點未能完成，請稍後再試。',
  CALCULATION_FAILED: 'Excel 計算未完成；可手動重試，系統會沿用前次錯誤重新產生計算程式。',
  CALCULATION_EXECUTION_TIMEOUT: '計算程式執行超過 120 秒；可手動重試，系統會沿用逾時原因重新產生更有效率的程式。',
  CALCULATION_CODE_REJECTED: '生成的計算程式未通過安全驗證；可手動重試，系統會沿用前次錯誤修正程式。',
  PRESENTATION_FAILED: 'Agent 簡報生成未完成；可使用同一份計畫與計算結果重新生成。',
  PRESENTATION_START_FAILED: '簡報生成工作節點未能啟動，請稍後再試。',
};
const PLANNER_STAGES = [
  { key: 'requirements_and_formula', label: '理解需求與規劃公式' },
  { key: 'calculation', label: '規劃計算' },
  { key: 'composition', label: '編排簡報' },
  { key: 'prompt-alignment', label: '核對 Prompt' },
  { key: 'calculation-code', label: '生成計算程式' },
  { key: 'calculation-execution', label: '執行計算' },
  { key: 'presentation-render', label: 'Agent 生成 PPTX' },
] as const;

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} 秒`;
}

function progressStateText(state: string | undefined) {
  return ({ waiting: '等待 Fargate 啟動', started: '執行中', completed: '已完成', retrying: '正在修正並重試', failed: '失敗' } as Record<string, string>)[state ?? 'waiting'];
}

function activeRunStartedAt(plan: PlannerJobResponse) {
  return ['CALCULATION_QUEUED', 'CALCULATING', 'PRESENTATION_QUEUED', 'PRESENTATION_RENDERING'].includes(plan.status) ? plan.updatedAt : plan.createdAt;
}

function stageForRealPlan(plan: PlannerJobResponse): { stage: StageKey; maxStage: number } {
  if (['PRESENTATION_READY'].includes(plan.status)) return { stage: 'output', maxStage: 5 };
  if (['PRESENTATION_QUEUED', 'PRESENTATION_RENDERING', 'PRESENTATION_FAILED'].includes(plan.status)) return { stage: 'output', maxStage: 5 };
  if (['CALCULATION_READY'].includes(plan.status)) return { stage: 'preview', maxStage: 4 };
  if (['CALCULATION_QUEUED', 'CALCULATING', 'CALCULATION_FAILED'].includes(plan.status)) return { stage: 'execute', maxStage: 3 };
  if (['NEEDS_REVIEW', 'APPROVED'].includes(plan.status) && plan.planningOutput) return { stage: 'plan', maxStage: 2 };
  return { stage: 'analysis', maxStage: 1 };
}

function App() {
  const [identity, setIdentity] = useState<DisplayIdentity | null>(null);
  const [stage, setStage] = useState<StageKey>('upload');
  const [maxStage, setMaxStage] = useState(0);
  const [prompt, setPrompt] = useState('請根據我提供的資料，找出重要趨勢與異常，必要時研究適用公式，並產生給主管看的決策簡報。');
  const [files, setFiles] = useState<File[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [realPlan, setRealPlan] = useState<PlannerJobResponse | null>(null);
  const [savedProjects, setSavedProjects] = useState<PlannerProjectSummary[]>([]);
  const [planJson, setPlanJson] = useState('');
  const [planDirty, setPlanDirty] = useState(false);
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
  const [now, setNow] = useState(() => Date.now());

  async function refreshSavedProjects() {
    if (!isRealPlannerConfigured() || !identity) return;
    try {
      setSavedProjects(await awsPlanner.list());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法讀取已儲存的專案');
    }
  }

  // A signed-in user can leave or reload the browser without losing the
  // server-side job. The list contains only that Cognito subject's projects.
  useEffect(() => {
    const handleAuthSessionCleared = () => {
      setIdentity(null);
      setSavedProjects([]);
      setError('登入已逾時，請重新使用 Cognito 登入');
    };
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, handleAuthSessionCleared);
    completeSignIn().then(async signedInIdentity => {
      setIdentity(signedInIdentity);
      if (signedInIdentity && isRealPlannerConfigured()) setSavedProjects(await awsPlanner.list());
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    });
    return () => window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, handleAuthSessionCleared);
  }, []);

  useEffect(() => {
    if (!realPlan || !ACTIVE_PLANNER_STATUSES.has(realPlan.status)) return;
    const timer = window.setTimeout(() => {
      awsPlanner.get(realPlan.jobId).then(updated => {
        setRealPlan(updated);
        if (updated.planningOutput) { setPlanJson(JSON.stringify(updated.planningOutput, null, 2)); setPlanDirty(false); }
        if (!ACTIVE_PLANNER_STATUSES.has(updated.status)) void refreshSavedProjects();
      }).catch(reason => setError(reason instanceof Error ? reason.message : '無法更新 Planner 狀態'));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [realPlan]);

  useEffect(() => {
    if (!realPlan || !ACTIVE_PLANNER_STATUSES.has(realPlan.status)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [realPlan?.jobId, realPlan?.status]);

  const stageIndex = STAGES.findIndex((item) => item.key === stage);
  const completedExecution = useMemo(
    () => job?.stages.filter((item) => item.status === 'COMPLETED').length ?? 0,
    [job],
  );
  const editablePlan = useMemo<AIPlanningOutputDto | null>(() => {
    if (!planJson) return realPlan?.planningOutput ?? null;
    try { return JSON.parse(planJson) as AIPlanningOutputDto; } catch { return null; }
  }, [planJson, realPlan?.planningOutput]);

  function updatePlanEditor(mutator: (draft: AIPlanningOutputDto) => void) {
    if (!editablePlan) {
      setError('計畫 JSON 無法解析，請先修正 JSON 後再使用欄位選單。');
      return;
    }
    const draft = JSON.parse(JSON.stringify(editablePlan)) as AIPlanningOutputDto;
    mutator(draft);
    setPlanJson(JSON.stringify(draft, null, 2));
    setPlanDirty(true);
  }

  function updateBinding(taskId: string, bindingIndex: number, update: Partial<AIPlanningOutputDto['calculation_plan']['tasks'][number]['input_bindings'][number]>) {
    updatePlanEditor(draft => {
      const task = draft.calculation_plan.tasks.find(item => item.task_id === taskId);
      if (task?.input_bindings[bindingIndex]) Object.assign(task.input_bindings[bindingIndex], update);
    });
  }

  function selectBindingWorkbook(taskId: string, bindingIndex: number, uploadId: string) {
    const workbook = realPlan?.workbookSchema.find(item => item.uploadId === uploadId);
    const sheet = workbook?.sheets.find(item => item.columns.length > 0) ?? workbook?.sheets[0];
    updateBinding(taskId, bindingIndex, { workbook_upload_id: uploadId, workbook_selector: workbook?.fileName ?? '', sheet_selector: sheet?.sheetName ?? '', column_selector: sheet?.columns[0] ?? '' });
  }

  function selectBindingSheet(taskId: string, bindingIndex: number, uploadId: string, sheetName: string) {
    const sheet = realPlan?.workbookSchema.find(item => item.uploadId === uploadId)?.sheets.find(item => item.sheetName === sheetName);
    updateBinding(taskId, bindingIndex, { sheet_selector: sheetName, column_selector: sheet?.columns[0] ?? '' });
  }

  function addMissingBinding(taskId: string, variable: string) {
    const workbook = realPlan?.workbookSchema.find(item => item.sheets.some(sheet => sheet.columns.length > 0));
    const sheet = workbook?.sheets.find(item => item.columns.length > 0);
    if (!workbook || !sheet) {
      setError('找不到可選的 Excel 欄位，請確認上傳檔案第一列包含欄位名稱。');
      return;
    }
    updatePlanEditor(draft => {
      const task = draft.calculation_plan.tasks.find(item => item.task_id === taskId);
      if (!task || task.input_bindings.some(item => item.variable === variable)) return;
      task.input_bindings.push({ variable, workbook_upload_id: workbook.uploadId, workbook_selector: workbook.fileName, sheet_selector: sheet.sheetName, column_selector: sheet.columns[0], cell_range_hint: '', aggregation: '請選擇與公式相符的彙總方式', required: true });
    });
  }

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
        const created = await awsPlanner.create(files, prompt.trim(), template);
        setRealPlan(created);
        void refreshSavedProjects();
        setPlanJson('');
        setPlanDirty(false);
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

  async function retryPlanning() {
    if (!realPlan || !RETRYABLE_PLANNING_ERRORS.has(realPlan.safeErrorCode ?? '')) return;
    setBusy(true);
    setError('');
    try {
      const retried = await awsPlanner.retryPlanning(realPlan.jobId);
      setRealPlan(retried);
      moveTo('analysis');
      void refreshSavedProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法重新規劃');
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan() {
    setBusy(true);
    setError('');
    try {
      if (realPlan?.planningOutput) {
        if (planDirty) throw new Error('請先儲存欄位／JSON 修改，確認通過後才能執行計算。');
        const approved = await awsPlanner.approve(realPlan.jobId, realPlan.planVersion);
        setRealPlan(approved);
        moveTo('execute');
        return;
      } else if (job) {
        setJob(await mockClient.approvePlan(job.jobId));
      } else return;
      moveTo('execute');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法核准計畫');
    } finally {
      setBusy(false);
    }
  }

  async function exportRealPptx() {
    if (!realPlan?.planningOutput || !realPlan.calculationSummary) throw new Error('請先完成真實計算');
    if (template && template.name !== realPlan.templateFileName) throw new Error('你選了新的 PPTX 範本，請先將它保存到此專案再輸出。');
    setBusy(true);
    setError('');
    try {
      if (!realPlan.presentationSummary) {
        setRealPlan(await awsPlanner.renderPresentation(realPlan.jobId));
        moveTo('output');
        return;
      }
      const url = await awsPlanner.presentationDownloadUrl(realPlan.jobId, 'deck');
      window.location.assign(url);
      setOutputReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PPTX 生成失敗');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPresentationData() {
    if (!realPlan?.presentationSummary) return;
    setBusy(true);
    setError('');
    try {
      window.location.assign(await awsPlanner.presentationDownloadUrl(realPlan.jobId, 'data'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'XLSX 下載失敗');
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplateForProject() {
    if (!realPlan || !template) return;
    setBusy(true);
    setError('');
    try {
      setRealPlan(await awsPlanner.attachTemplate(realPlan.jobId, template));
      await refreshSavedProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法將 PPTX 範本保存到專案');
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
    setStage('upload'); setMaxStage(0); setJob(null); setRealPlan(null); setPlanJson(''); setPlanDirty(false); setFiles([]); setTemplate(null);
    setPlanRevisions([]); setPreviewRevisions([]); setOutputReady(false); setSent(false); setRecipient('');
  }

  async function resumeProject(project: PlannerProjectSummary) {
    setBusy(true);
    setError('');
    try {
      const restored = await awsPlanner.get(project.jobId);
      setRealPlan(restored);
      setPrompt(restored.prompt ?? project.promptPreview);
      setPlanJson(restored.planningOutput ? JSON.stringify(restored.planningOutput, null, 2) : '');
      setPlanDirty(false);
      setFiles([]);
      setTemplate(null);
      const restoredStage = stageForRealPlan(restored);
      setStage(restoredStage.stage);
      setMaxStage(restoredStage.maxStage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法開啟已儲存的專案');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">L</span><div><strong>Lobster Studio</strong><small>Prompt-driven report agent</small></div></div>
        <div className="top-actions">
          <span className="environment"><i />UI-1 · Workshop</span>
          <span className={`badge ${isRealPlannerConfigured() ? 'real' : 'mock'}`}>{isRealPlannerConfigured() ? 'PLAN · CALC · PPTX REAL' : 'MOCK'}</span>
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
          <div className="stage-meta"><span>Job</span><strong>{realPlan?.jobId ?? job?.jobId ?? '尚未建立'}</strong><small>{isRealPlannerConfigured() ? 'Excel + Prompt + Plan + Calculation + PPTX REAL' : 'UI fixture only'}</small></div>
        </div>

        {error && <div className="notice warning">{error}</div>}

        {stage === 'upload' && <section className="stage-card upload-stage-card">
          <div className="intro-copy"><span className="eyebrow">One prompt, adaptive workflow</span><h2>把你想做的事情直接告訴龍蝦。</h2><p>不用填受眾、公式或簡報格式表格。Lobster 會從 Prompt 判斷目標、限制、資料需求、研究方式、Skill 與輸出規格，再交給你確認。</p></div>
          <label className="prompt-box"><span>任務 Prompt</span><textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：比較三種方案，找出適用公式與公開資料，做成給主管看的 10 頁決策簡報..." /><small>{isRealPlannerConfigured() ? '會儲存在你的私有專案中，供你日後續作。' : '目前只進行 mock 分析，不會送到模型或外部服務。'}</small></label>
          <label className="file-picker large"><input type="file" accept=".xlsx" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 20))} /><strong>選擇 Excel 檔案（最多 20 個）</strong><span>{isRealPlannerConfigured() ? '檔案會加密上傳至 AWS，專案與輸入資料保留 30 天' : 'Mock 模式不會上傳'}</span></label>
          {files.length > 0 && <div className="file-chips">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span>)}</div>}
          <label className="file-picker"><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => setTemplate(event.target.files?.[0] ?? null)} /><strong>選擇 PPTX 範本（生成前必填）</strong><span>{template ? `${template.name} · 將與此專案私有保存，供續作時使用` : '可先開始規劃；選擇後會與專案一併私有保存，供日後輸出使用'}</span></label>
          {realPlan && template && template.name !== realPlan.templateFileName && <button className="button secondary" disabled={busy} onClick={() => void saveTemplateForProject()}>將目前範本保存到此專案</button>}
          {identity && isRealPlannerConfigured() && <section className="saved-projects"><div className="saved-projects-head"><div><span className="eyebrow">你的已儲存專案</span><strong>從上次狀態繼續</strong></div><button className="button secondary" disabled={busy} onClick={() => void refreshSavedProjects()}>重新整理</button></div>{savedProjects.length === 0 ? <p>尚無可續作的專案。建立後會在這裡保留 30 天。</p> : <div className="saved-project-list">{savedProjects.map(project => <button key={project.jobId} className="saved-project" disabled={busy} onClick={() => void resumeProject(project)}><span className={`badge ${project.status === 'NEEDS_REVIEW' || project.status === 'APPROVED' ? 'real' : 'mock'}`}>{project.status}</span><strong>{project.title || project.promptPreview || '未命名規劃'}</strong><small>{project.fileNames.join('、') || '上傳尚未完成'} · {new Date(project.updatedAt).toLocaleString('zh-TW')}</small>{project.promptAlignmentScore !== null && <em>Prompt 相符度 {project.promptAlignmentScore}/100</em>} {project.safeErrorCode && <em>{project.safeErrorCode}</em>}</button>)}</div>}</section>}
          <button className="button primary stage-action" disabled={busy || !prompt.trim()} onClick={startAnalysis}>{busy ? '上傳與建立中...' : isRealPlannerConfigured() ? '上傳並開始真實 AI 分析 →' : '開啟非推論規劃範例 →'}</button>
        </section>}

        {stage === 'analysis' && realPlan && <section className="stage-card">
          <div className="agent-working"><div className="agent-orb">L</div><div><span className="badge real">REAL AWS PLANNER</span><h2>{realPlan.status === 'NEEDS_REVIEW' ? '真實計畫已完成' : realPlan.status === 'FAILED' ? '規劃失敗' : 'Fargate Agent 正在讀取 Excel 並建立計畫'}</h2><p>狀態：{realPlan.status} · Plan version {realPlan.planVersion}</p></div></div>
          {ACTIVE_PLANNER_STATUSES.has(realPlan.status) && <section className="planner-progress" aria-live="polite">
            <div className="planner-progress-summary"><div><span className="eyebrow">CloudWatch monitored progress</span><strong>{realPlan.progress?.currentStage ? PLANNER_STAGES.find(stageItem => stageItem.key === realPlan.progress?.currentStage)?.label : '等待工作節點啟動'}</strong><small>{progressStateText(realPlan.progress?.state)}{realPlan.progress?.attempt ? ` · 第 ${realPlan.progress.attempt} 次嘗試` : ''}</small></div><div><span>本次 AI 執行耗時</span><strong>{formatElapsed(activeRunStartedAt(realPlan), now)}</strong><small>快速模式：規劃與計算合計目標 15 分鐘內（不含人工審核）</small></div></div>
            <ol className="planner-stage-track">{PLANNER_STAGES.map((stageItem, index) => {
              const currentIndex = PLANNER_STAGES.findIndex(item => item.key === realPlan.progress?.currentStage);
              const state = currentIndex > index || (currentIndex === index && realPlan.progress?.state === 'completed') ? 'completed' : currentIndex === index ? 'active' : '';
              return <li className={state} key={stageItem.key}><i>{state === 'completed' ? '✓' : index + 1}</i><span>{stageItem.label}</span></li>;
            })}</ol>
            <p>狀態來自此工作任務對應的 CloudWatch 結構化事件；不會顯示 Excel 內容、Prompt 或完整容器日誌。</p>
          </section>}
          {realPlan.safeErrorCode && <div className="notice warning"><strong>{PLANNER_ERROR_MESSAGES[realPlan.safeErrorCode] ?? '工作未完成，請稍後再試。'}</strong><small>錯誤代碼：{realPlan.safeErrorCode}</small></div>}
          {realPlan.status === 'FAILED' && RETRYABLE_PLANNING_ERRORS.has(realPlan.safeErrorCode ?? '') && <button className="button primary" disabled={busy} onClick={() => void retryPlanning()}>{busy ? '正在重新啟動...' : '使用原檔案重新規劃 →'}</button>}
          {realPlan.status === 'CALCULATION_FAILED' && <button className="button primary" disabled={busy} onClick={async () => { try { setBusy(true); setRealPlan(await awsPlanner.retryCalculation(realPlan.jobId)); } catch (reason) { setError(reason instanceof Error ? reason.message : '無法重新計算'); } finally { setBusy(false); } }}>依相同計畫並沿用錯誤修正 →</button>}
          {realPlan.planningOutput && <div className="analysis-grid"><article><span>受眾</span><strong>{realPlan.planningOutput.prompt_contract.target_audience}</strong></article><article><span>頁數</span><strong>{realPlan.planningOutput.deck_plan.total_pages}</strong></article><article><span>公式</span><strong>{realPlan.planningOutput.formula_plan.formulas.length}</strong></article><article><span>計算任務</span><strong>{realPlan.planningOutput.calculation_plan.tasks.length}</strong></article><article><span>圖表</span><strong>{realPlan.planningOutput.prompt_contract.charts.length}</strong></article><article><span>Prompt 相符度</span><strong>{realPlan.promptAlignmentScore === null ? '—' : `${realPlan.promptAlignmentScore}/100`}</strong></article><article><span>來源座標</span><strong>{realPlan.sourceReferences.length}</strong></article></div>}
          {['NEEDS_REVIEW', 'APPROVED'].includes(realPlan.status) && realPlan.planningOutput && <button className="button primary stage-action" onClick={() => moveTo('plan')}>檢視與編輯真實計畫 →</button>}
        </section>}

        {stage === 'plan' && realPlan?.planningOutput && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">AIPlanningOutput v3 · REAL</span><h2>{realPlan.planningOutput.deck_plan.title}</h2><p>{realPlan.planningOutput.deck_plan.narrative_strategy}</p></div><span className="badge real">VERSION {realPlan.planVersion}</span></div>
          <div className="notice"><strong>快速規劃模式：</strong>先確認目標、頁數、公式與資料綁定即可；洞察文案與版面可在預覽階段再調整。開始計算前，請使用下方選單確認每個公式變數連到正確的 Excel 欄位。</div>
          <div className="requirement-grid">{realPlan.planningOutput.formula_plan.formulas.map(formula => <article key={formula.formula_id}><strong>{formula.name}</strong><p><code>{formula.expression}</code></p><small>{formula.status} · {formula.source_candidates.map(source => `${source.source_type}/${source.verification_state}`).join('、')}</small></article>)}</div>
          <div className="deck-plan-grid">{realPlan.planningOutput.deck_plan.slides.map(slide => <article className={`deck-page-card ${slide.kind}`} key={slide.page_number}><div className="deck-page-head"><span>{String(slide.page_number).padStart(2, '0')}</span><small>{slide.kind}</small></div><h3>{slide.title}</h3><p>{slide.key_message}</p><small>{slide.layout_guidance}</small></article>)}</div>
          {editablePlan && <details className="execution-plan binding-editor" open><summary>Excel 欄位綁定（計算前必須確認）</summary><p>每個公式變數必須剛好有一個綁定。先選 Excel 檔、工作表與欄位；變更後按「儲存手動修改」，後端會再次驗證選擇是否屬於此專案。</p>{realPlan.workbookSchema.length === 0 && <div className="notice warning">此舊專案尚未儲存欄位目錄；可重新規劃一次建立選單，或使用 JSON 手動調整。</div>}<div className="binding-task-list">{editablePlan.calculation_plan.tasks.map(task => { const formula = editablePlan.formula_plan.formulas.find(item => item.formula_id === task.formula_id); const missing = formula?.variables.filter(variable => !task.input_bindings.some(binding => binding.variable === variable.symbol)) ?? []; return <article className="binding-task" key={task.task_id}><div><strong>{task.objective}</strong><small>{task.task_id} · 公式：{formula?.expression ?? task.formula_id}</small></div>{task.input_bindings.map((binding, index) => { const workbook = realPlan.workbookSchema.find(item => item.uploadId === binding.workbook_upload_id); const sheet = workbook?.sheets.find(item => item.sheetName === binding.sheet_selector); return <div className="binding-row" key={`${binding.variable}-${index}`}><strong>{binding.variable}</strong><label><span>Excel</span><select value={binding.workbook_upload_id} onChange={event => selectBindingWorkbook(task.task_id, index, event.target.value)}>{realPlan.workbookSchema.map(item => <option value={item.uploadId} key={item.uploadId}>{item.fileName}</option>)}</select></label><label><span>工作表</span><select value={binding.sheet_selector} onChange={event => selectBindingSheet(task.task_id, index, binding.workbook_upload_id, event.target.value)}>{workbook?.sheets.map(item => <option value={item.sheetName} key={item.sheetName}>{item.sheetName}</option>)}</select></label><label><span>欄位</span><select value={binding.column_selector} onChange={event => updateBinding(task.task_id, index, { column_selector: event.target.value })}>{sheet?.columns.map(column => <option value={column} key={column}>{column}</option>)}</select></label><label><span>彙總方式</span><input value={binding.aggregation} onChange={event => updateBinding(task.task_id, index, { aggregation: event.target.value })} /></label></div>; })}{missing.map(variable => <button className="button secondary small" type="button" key={variable.symbol} onClick={() => addMissingBinding(task.task_id, variable.symbol)}>新增變數綁定：{variable.symbol}</button>)}{missing.length > 0 && <small className="binding-warning">尚缺 {missing.map(item => item.symbol).join('、')}；未補齊不可計算。</small>}</article>; })}</div><div className="binding-rules"><strong>新增／修改規則</strong><span>新增公式時，同步新增公式變數、對應計算任務、每個變數的欄位綁定與輸出欄位。</span><span>只改欄位時使用選單；不要手動改 workbook ID 或檔名。</span><span>新增圖表時，需連到既有 calculation task 與 formula；不確定時用自然語言請 AI 重規劃。</span></div></details>}
          <label className="prompt-box"><span>完整 JSON 手動編輯（進階）</span><textarea rows={22} value={planJson} onChange={event => { setPlanJson(event.target.value); setPlanDirty(true); }} /></label>
          <div className="action-row"><small>{planDirty ? '尚有未儲存修改；儲存後才可執行計算。' : '目前計畫已儲存並可送往計算。'}</small><button className="button secondary" disabled={busy || !planDirty} onClick={async () => { try { setBusy(true); const parsed = JSON.parse(planJson); const updated = await awsPlanner.manualEdit(realPlan.jobId, parsed, realPlan.planVersion); setRealPlan(updated); setPlanJson(JSON.stringify(updated.planningOutput, null, 2)); setPlanDirty(false); } catch (reason) { setError(reason instanceof Error ? reason.message : 'JSON 或 Excel 欄位綁定無效'); } finally { setBusy(false); } }}>儲存手動修改</button></div>
          <div className="ai-edit-box"><div><strong>用自然語言重新規劃</strong><small>會以相同 Excel、原 Prompt 與完整修改要求重新生成</small></div><input value={planInstruction} onChange={event => setPlanInstruction(event.target.value)} placeholder="例如：改成 12 頁，增加公式來源與風險頁" /><button className="button secondary" disabled={busy || !planInstruction.trim()} onClick={async () => { try { setBusy(true); const updated = await awsPlanner.revise(realPlan.jobId, planInstruction.trim(), realPlan.planVersion); setRealPlan(updated); setPlanInstruction(''); moveTo('analysis'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 修改失敗'); } finally { setBusy(false); } }}>送出 AI 修改</button></div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('analysis')}>返回分析</button><button className="button primary" disabled={busy} onClick={approvePlan}>核准此版本，執行真實計算 →</button></div>
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

        {stage === 'execute' && realPlan && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">Calculation Agent · REAL</span><h2>{realPlan.status === 'CALCULATION_READY' ? '實際 Excel 計算已完成' : realPlan.status === 'CALCULATION_FAILED' ? '計算未完成' : '正在生成並執行受限 Python 計算程式'}</h2><p>程式由已核准的 calculation plan 生成，執行前會驗證安全語法，並只讀取本專案的 Excel。</p></div><span className="badge real">{realPlan.status}</span></div>
          {realPlan.safeErrorCode && <div className="notice warning"><strong>{PLANNER_ERROR_MESSAGES[realPlan.safeErrorCode] ?? '工作未完成，請稍後再試。'}</strong><small>錯誤代碼：{realPlan.safeErrorCode}</small></div>}
          {ACTIVE_PLANNER_STATUSES.has(realPlan.status) && <div className="analysis-log"><span /><p><strong>{realPlan.progress?.currentStage === 'calculation-code' ? '生成程式' : realPlan.progress?.currentStage === 'calculation-execution' ? '執行與驗證' : '等待 Fargate'}</strong></p><span /><p>本次執行 {formatElapsed(activeRunStartedAt(realPlan), now)} · 目標 7 分鐘內</p></div>}
          {realPlan.status === 'CALCULATION_FAILED' && <button className="button primary" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); setRealPlan(await awsPlanner.retryCalculation(realPlan.jobId)); } catch (reason) { setError(reason instanceof Error ? reason.message : '無法重新計算'); } finally { setBusy(false); } }}>{busy ? '正在重新啟動...' : '依相同計畫並沿用錯誤修正 →'}</button>}
          {realPlan.calculationSummary && <><div className="analysis-grid"><article><span>計算耗時</span><strong>{(realPlan.calculationSummary.durationMs / 1000).toFixed(2)} 秒</strong></article><article><span>任務數</span><strong>{realPlan.calculationSummary.tasks.length}</strong></article><article><span>程式雜湊</span><strong>{realPlan.calculationSummary.codeSha256.slice(0, 12)}</strong></article></div><details className="execution-plan" open><summary>生成的 Python 程式（已驗證）</summary><pre className="calculation-code">{realPlan.calculationSummary.codePreview}</pre></details><div className="requirement-grid">{realPlan.calculationSummary.tasks.map(task => <article key={task.taskId}><strong>{task.metricId} · {task.formulaId}</strong><p>{task.taskId}：{task.rowCount} 筆結果</p>{task.preview.slice(0, 2).map((row, index) => <small key={index}>{JSON.stringify(row)}</small>)}{task.warnings.map(warning => <small key={warning}>⚠ {warning}</small>)}</article>)}</div></>}
          {realPlan.status === 'CALCULATION_READY' && realPlan.planningOutput && realPlan.calculationSummary && <button className="button primary stage-action" onClick={() => moveTo('preview')}>以真實資料預覽並生成 PPTX →</button>}
        </section>}

        {stage === 'execute' && job && !realPlan && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">Agent runtime</span><h2>Lobster 正在依計畫使用 Skill 與工具</h2></div><div className="counter"><strong>{completedExecution}/{job.stages.length}</strong><span>stages verified</span></div></div>
          <div className="execution-layout"><div className="timeline">{job.stages.map((item) => <article className="stage" key={item.id}><i className={item.status.toLowerCase()} /><div><div><strong>{item.label}</strong><span>{item.status}</span></div><p>{item.description}</p><small>Attempt {item.attempt} · Independent Gate {item.gate ?? 'PENDING'}</small></div></article>)}</div><aside className="runtime-card"><span className="eyebrow">Current worker</span><h3>{job.stages.find((item) => item.status === 'RUNNING')?.label ?? '等待下一階段'}</h3><p>正式版會顯示 Strands agent 的 tool receipt、引用、token、重試與 Gate finding。</p><button className="button primary full" disabled={busy} onClick={advanceExecution}>完成目前 Mock 工作 →</button></aside></div>
        </section>}

        {stage === 'preview' && realPlan?.planningOutput && realPlan.calculationSummary && <section className="stage-card preview-stage">
          <div className="section-title"><div><span className="eyebrow">Real calculation preview</span><h2>依真實計算結果建立的簡報</h2><p>每張圖表只會使用已驗證的 calculation artifact；下方可回到計畫頁進行 JSON 或自然語言修改後重新計算。</p></div><span className="badge real">{realPlan.planningOutput.deck_plan.total_pages} SLIDES</span></div>
          <div className="deck-plan-grid">{realPlan.planningOutput.deck_plan.slides.map(slide => <article className={`deck-page-card ${slide.kind}`} key={slide.page_number}><div className="deck-page-head"><span>{String(slide.page_number).padStart(2, '0')}</span><small>{slide.kind}</small></div><h3>{slide.title}</h3><p>{slide.key_message}</p><small>{slide.chart_ids.length ? `圖表：${slide.chart_ids.join('、')}` : '無圖表'}</small><small>{slide.evidence_requirements.join('、')}</small></article>)}</div>
          <details className="execution-plan" open><summary>圖表資料欄位與計算方式</summary>{realPlan.planningOutput.prompt_contract.charts.map(chart => { const task = realPlan.planningOutput?.calculation_plan.tasks.find(item => item.task_id === chart.calculation_task_ids[0]); const formula = realPlan.planningOutput?.formula_plan.formulas.find(item => item.formula_id === task?.formula_id); return <article className="plan-card" key={chart.chart_id}><strong>{chart.title}</strong><p>來源欄位：{task?.input_bindings.map(binding => `${binding.workbook_selector}／${binding.sheet_selector}／${binding.column_selector}`).join('；') || '尚無計算任務'}</p><small>公式：{formula?.expression || '尚無公式'}</small><small>計算任務：{task?.task_id || '—'} · 實際結果筆數：{realPlan.calculationSummary?.tasks.find(item => item.taskId === task?.task_id)?.rowCount ?? 0}</small></article>; })}</details>
          <div className="notice">範本：{template?.name ?? realPlan.templateFileName ?? '未提供，會使用預設 16:9 版型。'}。{realPlan.templateFileName && (!template || template.name === realPlan.templateFileName) ? '範本已隨專案私有保存，重新登入或重整後仍可使用。' : template ? '此範本尚未保存到專案；請回到上傳步驟按下保存。' : '沒有範本時會使用預設樣式。'}文字、原生圖表與頁面會保留為 PowerPoint 可編輯物件。</div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('plan')}>回到計畫修改</button><button className="button primary" disabled={(template !== null && template.name !== realPlan.templateFileName) || busy} onClick={() => moveTo('output')}>交給 Agent 生成 PPTX →</button></div>
        </section>}

        {stage === 'preview' && job && <section className="stage-card preview-stage">
          <div className="section-title"><div><span className="eyebrow">Editable plan preview</span><h2>逐頁預覽與 AI 編輯</h2></div><span className="badge mock">{job.deckPlan.slides.length} slides</span></div>
          <div className="preview-workbench"><div className="slide-list">{job.deckPlan.slides.map((slide, index) => <button className={selectedSlide === index ? 'active' : ''} key={`${slide.pageNumber}-${slide.title}`} onClick={() => setSelectedSlide(index)}><span>{slide.pageNumber}</span><strong>{slide.title}</strong></button>)}</div><div className="slide-canvas"><span>{job.deckPlan.slides[selectedSlide].kind} · page {job.deckPlan.slides[selectedSlide].pageNumber}</span><h3>{job.deckPlan.slides[selectedSlide].title}</h3><p>{job.deckPlan.slides[selectedSlide].keyMessage}</p><div className="canvas-tags">{job.deckPlan.slides[selectedSlide].contentElements.map((element) => <small key={element}>{element}</small>)}</div><small>Non-inferential UI placeholder · SYNTHETIC EXAMPLE</small></div><div className="preview-info"><span className="eyebrow">Slide intent</span><h3>第 {job.deckPlan.slides[selectedSlide].pageNumber} 頁</h3><p>{job.deckPlan.slides[selectedSlide].communicationGoal}</p>{job.deckPlan.slides[selectedSlide].chartIds.length > 0 && <small>圖表：{job.deckPlan.slides[selectedSlide].chartIds.join('、')}</small>}{job.deckPlan.slides[selectedSlide].insightIds.length > 0 && <small>洞察：{job.deckPlan.slides[selectedSlide].insightIds.join('、')}</small>}<small>{job.deckPlan.slides[selectedSlide].speakerNotesGuidance}</small>{previewRevisions.map((item, index) => <small key={`${item}-${index}`}>Revision {index + 1}: {item}</small>)}</div></div>
          <div className="ai-edit-box"><div><strong>問 AI 修改預覽</strong><small>例如：讓標題更有行動感、換圖表、合併兩頁</small></div><input value={previewInstruction} onChange={(event) => setPreviewInstruction(event.target.value)} placeholder="輸入簡報修改要求..." /><button className="button secondary" disabled={!previewInstruction.trim()} onClick={() => { setPreviewRevisions((items) => [...items, previewInstruction.trim()]); setPreviewInstruction(''); }}>記錄 Mock 修改</button></div>
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('plan')}>回到計畫</button><button className="button primary" onClick={() => moveTo('output')}>確認預覽並輸出 →</button></div>
        </section>}

        {stage === 'output' && realPlan?.planningOutput && realPlan.calculationSummary && <section className="stage-card">
          <div className="section-title"><div><span className="eyebrow">Strands Presentation Agent · REAL</span><h2>輸出可編輯 PowerPoint</h2><p>Agent 會讀取已核准的 DeckPlan、計算 artifact 與範本，生成 python-pptx 程式並輸出 PPTX/XLSX。</p></div><span className="badge real">{realPlan.status}</span></div>
          {ACTIVE_PLANNER_STATUSES.has(realPlan.status) && <div className="analysis-log"><span /><p><strong>{realPlan.progress?.currentStage === 'presentation-render' ? 'Agent 正在生成簡報程式與 PPTX' : '等待 Fargate'}</strong></p><span /><p>本次執行 {formatElapsed(activeRunStartedAt(realPlan), now)} · 目標 15 分鐘內</p></div>}
          {realPlan.safeErrorCode && <div className="notice warning"><strong>{PLANNER_ERROR_MESSAGES[realPlan.safeErrorCode] ?? '簡報生成未完成，請稍後再試。'}</strong><small>錯誤代碼：{realPlan.safeErrorCode}</small></div>}
          <div className="output-grid"><article><span>PPTX</span><h3>Agent 生成簡報</h3><p>{realPlan.presentationSummary ? `${realPlan.presentationSummary.slideCount} 頁、${realPlan.presentationSummary.chartCount} 個原生圖表` : '尚未生成；按下按鈕後會啟動 Fargate presentation agent。'}</p><small>{template?.name ? `範本：${template.name}` : realPlan.templateFileName ? `已保存範本：${realPlan.templateFileName}` : '未提供範本，使用預設版型'}</small></article><article><span>DATA</span><h3>同步 XLSX</h3><p>{realPlan.presentationSummary ? `${realPlan.presentationSummary.tableCount} 個表格資料同步輸出` : `${realPlan.calculationSummary.tasks.length} 項已驗證計算任務將提供圖表資料。`}</p><small>不插入合成資料或示範資料。</small></article></div>
          {realPlan.presentationSummary && <details className="execution-plan" open><summary>Agent 生成驗證摘要</summary><div className="requirement-grid"><article><strong>{realPlan.presentationSummary.validationStatus}</strong><p>Renderer SHA：{realPlan.presentationSummary.rendererCodeSha256.slice(0, 12)}</p><small>模型：{realPlan.presentationSummary.modelId}</small></article>{realPlan.presentationSummary.findings.slice(0, 6).map(finding => <article key={`${finding.code}-${finding.message}`}><strong>{finding.severity} · {finding.code}</strong><p>{finding.message}</p><small>{finding.origin_stage}</small></article>)}</div></details>}
          {outputReady && <div className="notice">下載已開始。可返回計畫調整後重新計算或重新生成。</div>}
          <div className="action-row"><button className="button secondary" onClick={() => moveTo('preview')}>返回預覽</button>{realPlan.presentationSummary && <button className="button secondary" disabled={busy} onClick={() => void downloadPresentationData()}>下載同步 XLSX</button>}<button className="button primary" disabled={(template !== null && template.name !== realPlan.templateFileName) || busy || ACTIVE_PLANNER_STATUSES.has(realPlan.status)} onClick={() => void exportRealPptx()}>{busy || ACTIVE_PLANNER_STATUSES.has(realPlan.status) ? 'Agent 正在生成...' : realPlan.presentationSummary ? '下載 Agent PPTX' : '啟動 Agent 生成 PPTX'}</button></div>
        </section>}

        {stage === 'output' && !realPlan && <section className="stage-card">
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
