/**
 * VoiceButton — mic icon that starts/stops speech recognition.
 * Shows interim text below while recording. Hides on unsupported browsers.
 */
import { useEffect } from 'react';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface Props {
  onResult: (text: string) => void;
  onInterim?: (text: string) => void;
  lang?: string;
}

export function VoiceButton({ onResult, onInterim, lang = 'zh-TW' }: Props) {
  const { supported, listening, transcript, interim, toggle } = useVoiceInput(lang);

  useEffect(() => {
    if (transcript) onResult(transcript);
  }, [transcript]);

  useEffect(() => {
    onInterim?.(interim);
  }, [interim]);

  if (!supported) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={toggle}
        onMouseDown={e => e.preventDefault()} // Don't steal focus from the input
        title={listening ? '停止語音輸入' : '語音輸入（中文）'}
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: listening ? '2px solid var(--primary)' : '1px solid var(--border)',
          background: listening ? '#FDEDEC' : 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.15rem',
          transition: 'all 0.2s ease',
          animation: listening ? 'pulse 1.2s infinite' : 'none',
          flexShrink: 0,
        }}
        aria-label={listening ? '停止語音輸入' : '開始語音輸入'}
      >
        {listening ? '⏹' : '🎤'}
      </button>
      {listening && (
        <div style={{
          fontSize: '0.6rem',
          color: 'var(--primary)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          錄音中...
        </div>
      )}
      {listening && interim && (
        <div style={{
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontStyle: 'italic',
        }}>
          {interim}
        </div>
      )}
    </div>
  );
}
