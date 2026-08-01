import { useState, useEffect, useRef } from 'react';

interface Props {
  progress: number;
}

const PROCESSING_STEPS = [
  { at: 0, label: '解析報表結構與欄位' },
  { at: 20, label: '建立資料來源追蹤' },
  { at: 40, label: '計算指標與排名' },
  { at: 60, label: 'AI 規劃簡報結構與內容' },
  { at: 80, label: '驗證數據一致性' },
  { at: 100, label: '產生簡報預覽' },
];

export function ProcessingStage({ progress }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isAIStep = progress >= 60 && progress < 80;

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
            {i === arr.length - 1 && isAIStep && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}— 已等待 {elapsed} 秒
              </span>
            )}
          </div>
        ))}
      </div>

      {isAIStep && (
        <div style={{
          marginTop: '1.5rem', padding: '1rem', background: 'var(--accent)',
          borderRadius: 'var(--radius-sm)', maxWidth: '400px', margin: '1.5rem auto 0',
          fontSize: '0.8rem', color: 'var(--text-light)', lineHeight: 1.7,
        }}>
          🤖 正在呼叫 AI 生成簡報規格...<br/>
          使用模型：DeepSeek V4 Flash<br/>
          預計需要 30-90 秒，請稍候
        </div>
      )}
    </div>
  );
}
