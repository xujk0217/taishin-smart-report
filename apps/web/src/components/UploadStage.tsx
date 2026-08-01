import React, { useState, useRef } from 'react';
import { VoiceButton } from './VoiceButton';

interface Props {
  onComplete: (files: File[], prompt: string, template?: File) => void;
}

export function UploadStage({ onComplete }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    setError('');
    const supported = Array.from(fileList).filter(f =>
      /\.(xlsx|xlsm|xls|csv|tsv|pdf)$/i.test(f.name)
    );
    if (supported.length === 0 && fileList.length > 0) {
      setError('請上傳 Excel、CSV 或 PDF 格式的檔案');
      return;
    }
    setFiles(prev => [...prev, ...supported]);
  };

  const handleSubmit = () => {
    if (files.length === 0 || !prompt.trim()) return;
    onComplete(files, prompt, template ?? undefined);
  };

  return (
    <div className="card">
      <h2>📊 上傳報表並輸入分析需求</h2>

      {/* File upload */}
      <div
        className={`upload-zone ${dragActive ? 'active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv,.tsv,.pdf"
          multiple
          onChange={e => handleFiles(e.target.files)}
        />
        <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>📁</div>
        <div style={{ fontSize: '1rem', fontWeight: 500 }}>
          {files.length > 0 ? `已選擇 ${files.length} 個檔案` : '拖曳報表檔案到此，或點擊上傳'}
        </div>
        <div style={{ color: 'var(--text-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          支援 .xlsx、.csv、.pdf 格式，可同時上傳多張報表
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ margin: '1rem 0', padding: '0.8rem', background: '#FEF2F2', borderRadius: '8px', color: '#DC2626', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div style={{ margin: '1rem 0', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {files.map((f, i) => (
            <span key={i} className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              📄 {f.name} ({(f.size / 1024).toFixed(0)} KB)
              <button
                onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                style={{ marginLeft: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Template upload (optional) */}
      <div style={{ marginTop: '1.2rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
          🎨 PPT 模板（選填，上傳你的品牌模板 .pptx）
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <input
            type="file"
            accept=".pptx"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f && f.name.endsWith('.pptx')) setTemplate(f);
            }}
            style={{ fontSize: '0.85rem' }}
          />
          {template && (
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              📄 {template.name} ({(template.size / 1024).toFixed(0)} KB)
              <button
                onClick={() => setTemplate(null)}
                style={{ marginLeft: '0.4rem', background: 'none', border: 'none', cursor: 'pointer' }}
              >×</button>
            </span>
          )}
        </div>
        <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          系統會在你的模板頁面上疊加數據、圖表和分析。不上傳則使用預設版面。
        </div>
      </div>

      {/* Prompt */}
      <div style={{ marginTop: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
          📝 分析需求（告訴 AI 你想要什麼樣的簡報）
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <textarea
            className="textarea"
            style={{ flex: 1 }}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="例如：分析這份報表的關鍵趨勢，比較各項目表現，產生給主管的分析簡報..."
          />
          <VoiceButton onResult={text => setPrompt(prev => prev + text)} />
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          AI 會自動辨識報表間的關聯與欄位對應，計算指標並生成專業簡報。支援語音輸入 🎤
        </div>
      </div>

      {/* Submit */}
      <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleSubmit}
          disabled={files.length === 0 || !prompt.trim()}
        >
          開始分析 →
        </button>
      </div>
    </div>
  );
}
