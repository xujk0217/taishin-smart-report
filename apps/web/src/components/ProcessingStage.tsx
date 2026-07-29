import React from 'react';

interface Props {
  progress: number;
}

const PROCESSING_STEPS = [
  { at: 0, label: '解析 Excel 工作表結構...' },
  { at: 20, label: '正規化資料與建立來源追蹤...' },
  { at: 40, label: '計算市占率、排名、月增率...' },
  { at: 60, label: 'AI 產生市場洞察分析...' },
  { at: 80, label: '驗證數據一致性...' },
  { at: 100, label: '產生簡報預覽...' },
];

export function ProcessingStage({ progress }: Props) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
      <div className="spinner" style={{ margin: '0 auto 1.5rem' }} />
      <h2 style={{ justifyContent: 'center' }}>⚙️ 執行中...</h2>
      
      <div className="progress-bar" style={{ margin: '1.5rem auto', maxWidth: '400px' }}>
        <div className="fill" style={{ width: `${progress}%` }} />
      </div>
      
      <div style={{ marginTop: '1.5rem' }}>
        {PROCESSING_STEPS.filter(s => s.at <= progress).map((s, i, arr) => (
          <div key={i} style={{
            fontSize: '0.85rem',
            color: i === arr.length - 1 ? 'var(--primary)' : 'var(--success)',
            margin: '0.3rem 0',
            fontWeight: i === arr.length - 1 ? 500 : 400,
          }}>
            {i === arr.length - 1 ? '▶' : '✓'} {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
