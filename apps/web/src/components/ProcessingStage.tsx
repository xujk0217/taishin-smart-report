import { useState, useEffect, useRef } from 'react';

interface Props {
  progress: number;
}

const PROCESSING_STEPS = [
  { at: 0, label: '解析 Excel 工作表結構' },
  { at: 20, label: '正規化資料與建立來源追蹤' },
  { at: 40, label: '計算市占率、排名、月增率' },
  { at: 60, label: 'AI 規劃簡報結構與洞察分析' },
  { at: 80, label: '驗證數據一致性' },
  { at: 100, label: '產生簡報預覽' },
];

const AI_THINKING = [
  '分析資料欄位與期間格式...',
  '識別 34 家銀行的市場定位...',
  '計算各期間市占率排名...',
  '比較台新與競爭者的差距...',
  '產生市場趨勢洞察...',
  '規劃圖表配置與版面安排...',
  '生成 KPI 摘要與結論建議...',
  '驗證所有數字的一致性...',
  '優化簡報結構與敘事邏輯...',
  '最終檢查元素配置...',
];

export function ProcessingStage({ progress }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [thinkIdx, setThinkIdx] = useState(0);
  const startRef = useRef(Date.now());

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cycle through AI thinking messages when stuck at 60%
  useEffect(() => {
    if (progress >= 60 && progress < 80) {
      const interval = setInterval(() => {
        setThinkIdx(prev => (prev + 1) % AI_THINKING.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [progress]);

  const currentStep = PROCESSING_STEPS.filter(s => s.at <= progress).pop();
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
                {' '}({elapsed}s)
              </span>
            )}
          </div>
        ))}
      </div>

      {/* AI thinking stream */}
      {isAIStep && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem 1.2rem',
          background: 'var(--accent)',
          borderRadius: 'var(--radius-sm)',
          maxWidth: '460px',
          margin: '1.5rem auto 0',
          textAlign: 'left',
        }}>
          <div style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--primary)',
            marginBottom: '0.5rem',
          }}>
            🤖 AI 正在思考...
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-light)',
            lineHeight: 1.7,
            minHeight: '3.5rem',
          }}>
            {AI_THINKING.slice(0, thinkIdx + 1).map((msg, i) => (
              <div key={i} style={{
                opacity: i === thinkIdx ? 1 : 0.5,
                transition: 'opacity 0.3s',
              }}>
                {i === thinkIdx ? '▸ ' : '✓ '}{msg}
              </div>
            ))}
          </div>
          <div style={{
            marginTop: '0.6rem',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
          }}>
            DeepSeek V4 Flash · 預計需要 30-90 秒 · 已用 {elapsed} 秒
          </div>
        </div>
      )}
    </div>
  );
}
