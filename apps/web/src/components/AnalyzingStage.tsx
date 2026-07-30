import { useState, useEffect } from 'react';

interface Props {
  prompt: string;
  status?: string;
}

export function AnalyzingStage({ prompt, status }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
      <div className="spinner" style={{ margin: '0 auto 1.5rem' }} />
      <h2 style={{ justifyContent: 'center' }}>🤖 AI 正在分析你的需求...</h2>
      <p style={{ color: 'var(--text-light)', marginTop: '1rem', maxWidth: '500px', margin: '1rem auto 0' }}>
        正在解讀你的 Prompt，判斷報告對象、探索計算指標、生成策略洞察
      </p>

      {status && (
        <div style={{
          marginTop: '1.5rem', padding: '1rem 1.2rem', background: 'var(--accent)',
          borderRadius: 'var(--radius-sm)', textAlign: 'left', maxWidth: '500px',
          margin: '1.5rem auto 0', fontSize: '0.82rem', lineHeight: 1.8,
          whiteSpace: 'pre-line',
        }}>
          <div style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: '0.3rem' }}>
            AI Pipeline 進度
          </div>
          {status}
        </div>
      )}

      <div style={{
        marginTop: '1.2rem', padding: '1rem', background: 'var(--accent)',
        borderRadius: 'var(--radius-sm)', textAlign: 'left', maxWidth: '500px',
        margin: '1.2rem auto 0',
      }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>你的需求：</div>
        <div style={{ fontSize: '0.85rem', maxHeight: 100, overflow: 'auto' }}>{prompt}</div>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        DeepSeek V4 Flash · 已用 {elapsed} 秒 · 預計 120-300 秒
      </div>
    </div>
  );
}
