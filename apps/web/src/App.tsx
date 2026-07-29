import React, { useState } from 'react';

type JobStage = 
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'formula_plan'
  | 'computing'
  | 'lenses'
  | 'validating'
  | 'preview'
  | 'adjusting'
  | 'rendering'
  | 'completed';

interface JobState {
  stage: JobStage;
  progress: number;
  fileName?: string;
  formulaPlan?: any;
  evidencePacket?: any;
  slideDeckSpec?: any;
}

const STAGES: { key: JobStage; label: string }[] = [
  { key: 'uploading', label: '上傳 Excel 檔案' },
  { key: 'parsing', label: '解析工作表結構' },
  { key: 'formula_plan', label: '建立公式計畫（等待確認）' },
  { key: 'computing', label: '計算指標與凍結 EvidencePacket' },
  { key: 'lenses', label: '三個洞察透鏡平行分析' },
  { key: 'validating', label: '驗證 Claims 與去重' },
  { key: 'preview', label: '產生 HTML 預覽' },
  { key: 'adjusting', label: '自然語言調整' },
  { key: 'rendering', label: '產生 PPTX / XLSX' },
  { key: 'completed', label: '完成' },
];

function App() {
  const [job, setJob] = useState<JobState>({ stage: 'idle', progress: 0 });
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [adjustment, setAdjustment] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setJob({ stage: 'uploading', progress: 10, fileName: file.name });

    // Simulate pipeline stages for demo
    await simulateStage('parsing', 25);
    await simulateStage('formula_plan', 35);
    // In real app, would wait for user approval here
    await simulateStage('computing', 50);
    await simulateStage('lenses', 65);
    await simulateStage('validating', 75);
    await simulateStage('preview', 85);
  };

  const simulateStage = (stage: JobStage, progress: number) => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        setJob(prev => ({ ...prev, stage, progress }));
        resolve();
      }, 800);
    });
  };

  const handleApproveFormula = () => {
    setJob(prev => ({ ...prev, stage: 'computing', progress: 50 }));
  };

  const handleAdjustment = () => {
    if (!adjustment.trim()) return;
    // In real app: POST /jobs/{jobId}/adjustments
    alert(`調整已送出：${adjustment}\n（數字修改將被拒絕）`);
    setAdjustment('');
  };

  const handleDownload = () => {
    // In real app: GET presigned URL
    alert('下載 PPTX（原生可編輯圖表）\n下載 XLSX（含完整稽核工作表）');
    setJob(prev => ({ ...prev, stage: 'completed', progress: 100 }));
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>智匯數據簡報神器</h1>
          <div className="subtitle">台新新光金控 × AI 報表轉簡報系統</div>
        </div>
      </header>

      <main className="main">
        {job.stage === 'idle' && (
          <div className="card">
            <h2>上傳信用卡統計 Excel</h2>
            <label className="upload-zone">
              <input
                type="file"
                accept=".xlsx,.xlsm"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                拖曳檔案或點擊上傳
              </div>
              <div style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>
                支援 .xlsx 格式，多工作表信用卡統計資料
              </div>
            </label>
            <div style={{ marginTop: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                分析需求：
              </label>
              <textarea
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--accent)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  minHeight: '80px',
                  resize: 'vertical',
                }}
                placeholder="例如：分析台新信用卡 114 年 1-12 月市占率與排名趨勢"
                defaultValue="分析台新信用卡 114 年 1-12 月市占率與排名趨勢"
              />
            </div>
          </div>
        )}

        {job.stage !== 'idle' && job.stage !== 'preview' && job.stage !== 'completed' && (
          <div className="card">
            <h2>處理進度 {job.fileName && `- ${job.fileName}`}</h2>
            <div className="progress-bar">
              <div className="fill" style={{ width: `${job.progress}%` }} />
            </div>
            <ul className="stage-list" style={{ marginTop: '1.5rem' }}>
              {STAGES.map(s => {
                const stageIdx = STAGES.findIndex(x => x.key === s.key);
                const currentIdx = STAGES.findIndex(x => x.key === job.stage);
                const status = stageIdx < currentIdx ? 'completed' : stageIdx === currentIdx ? 'active' : '';
                return (
                  <li key={s.key} className={status}>
                    {s.label}
                    {s.key === 'formula_plan' && job.stage === 'formula_plan' && (
                      <span style={{ marginLeft: 'auto' }}>
                        <button className="btn btn-primary" onClick={handleApproveFormula} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>
                          核准公式計畫
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {job.stage === 'formula_plan' && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: '#FFF3E0', borderRadius: '8px' }}>
                <strong>⚠️ 不支援項目：</strong>年增率 (YoY) - 缺少 113 年同期資料
              </div>
            )}
          </div>
        )}

        {(job.stage === 'preview' || job.stage === 'completed') && (
          <>
            <div className="card">
              <h2>簡報預覽</h2>
              <div className="preview-container">
                {/* Slide thumbnails */}
                <div className="slide-thumbnails">
                  {['封面', '市場分析', '市占率趨勢', '排名變化', '月增率', '結論'].map((title, i) => (
                    <div
                      key={i}
                      className={`slide-thumb ${selectedSlide === i ? 'active' : ''}`}
                      onClick={() => setSelectedSlide(i)}
                    >
                      <div style={{ fontWeight: 500 }}>{title}</div>
                    </div>
                  ))}
                </div>

                {/* Main preview */}
                <div className="slide-preview">
                  <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h3 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>
                      {selectedSlide === 0 ? '台新信用卡 114 年度市場分析' : `第 ${selectedSlide + 1} 頁預覽`}
                    </h3>
                    <p style={{ color: 'var(--text-light)' }}>
                      台新簽帳金額市占率{' '}
                      <span className="tooltip-demo">
                        10.61%
                        <span className="tooltip-content">
                          📊 簽帳金額市占率<br/>
                          📐 entity_value / total * 100<br/>
                          📋 工作表: 簽帳金額 | 儲存格: C5<br/>
                          ⚠️ 僅含簽帳金額
                        </span>
                      </span>
                      ，排名第{' '}
                      <span className="tooltip-demo">
                        5
                        <span className="tooltip-content">
                          📊 簽帳金額排名<br/>
                          📋 依簽帳金額由大至小<br/>
                          🏦 15 家銀行中排名
                        </span>
                      </span>
                    </p>
                  </div>
                </div>

                {/* Evidence panel */}
                <div className="evidence-panel">
                  <h3>來源證據</h3>
                  <div style={{ fontSize: '0.85rem' }}>
                    <div style={{ padding: '0.5rem', background: '#F5F5F5', borderRadius: '4px', marginBottom: '0.5rem' }}>
                      <strong>Claim MC-001</strong><br/>
                      台新 114/12 簽帳金額市占率 10.61%<br/>
                      <span style={{ color: 'var(--text-light)' }}>Evidence: metric-share-001</span>
                    </div>
                    <div style={{ padding: '0.5rem', background: '#F5F5F5', borderRadius: '4px', marginBottom: '0.5rem' }}>
                      <strong>Claim MC-002</strong><br/>
                      台新簽帳金額排名第 5（共 15 家）<br/>
                      <span style={{ color: 'var(--text-light)' }}>Evidence: metric-rank-001</span>
                    </div>
                    <div style={{ padding: '0.5rem', background: '#FFF3E0', borderRadius: '4px' }}>
                      <strong>⚠️ 已阻擋</strong><br/>
                      年增率 (YoY) 缺少 113 年資料
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Adjustment input */}
            <div className="card">
              <h2>自然語言調整</h2>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <input
                  type="text"
                  value={adjustment}
                  onChange={e => setAdjustment(e.target.value)}
                  placeholder="例如：移除 YoY 敘述，將策略建議改得更行動導向"
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: '1px solid var(--accent)',
                    borderRadius: '8px',
                    fontSize: '1rem',
                  }}
                />
                <button className="btn btn-primary" onClick={handleAdjustment}>
                  送出調整
                </button>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-light)' }}>
                可修改：標題、敘述、順序、版面 ｜ 禁止修改：數字、排名、必要 Caveat
              </div>
            </div>

            {/* Download */}
            <div className="card" style={{ textAlign: 'center' }}>
              <button className="btn btn-primary" onClick={handleDownload} style={{ marginRight: '1rem' }}>
                📥 下載 PPTX（原生可編輯）
              </button>
              <button className="btn btn-primary" onClick={handleDownload}>
                📥 下載 XLSX（稽核工作簿）
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
