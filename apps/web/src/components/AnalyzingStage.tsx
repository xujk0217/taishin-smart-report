import React from 'react';

interface Props {
  prompt: string;
}

export function AnalyzingStage({ prompt }: Props) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
      <div className="spinner" style={{ margin: '0 auto 1.5rem' }} />
      <h2 style={{ justifyContent: 'center' }}>🤖 AI 正在分析你的需求...</h2>
      <p style={{ color: 'var(--text-light)', marginTop: '1rem', maxWidth: '500px', margin: '1rem auto 0' }}>
        正在解讀你的 Prompt，判斷需要計算哪些指標、產生哪些圖表，並規劃簡報架構
      </p>
      <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--accent)', borderRadius: 'var(--radius-sm)', textAlign: 'left', maxWidth: '500px', margin: '1.5rem auto 0' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>你的需求：</div>
        <div style={{ fontSize: '0.9rem' }}>{prompt}</div>
      </div>
    </div>
  );
}
