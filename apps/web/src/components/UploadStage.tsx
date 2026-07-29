import React, { useState, useRef } from 'react';

interface Props {
  onComplete: (files: File[], prompt: string) => void;
}

export function UploadStage({ onComplete }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState('分析台新信用卡 114 年 1-12 月市占率與排名趨勢，並產生管理報告簡報');
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    setError('');
    const xlsxFiles = Array.from(fileList).filter(f =>
      f.name.endsWith('.xlsx') || f.name.endsWith('.xlsm') || f.name.endsWith('.xls')
    );
    if (xlsxFiles.length === 0 && fileList.length > 0) {
      setError('請上傳 .xlsx 或 .xlsm 格式的 Excel 檔案');
      return;
    }
    setFiles(prev => [...prev, ...xlsxFiles]);
  };

  const handleSubmit = () => {
    if (files.length === 0 || !prompt.trim()) return;
    onComplete(files, prompt);
  };

  return (
    <div className="card">
      <h2>📊 上傳 Excel 並輸入分析需求</h2>

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
          accept=".xlsx,.xlsm,.xls"
          multiple
          onChange={e => handleFiles(e.target.files)}
        />
        <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>📁</div>
        <div style={{ fontSize: '1rem', fontWeight: 500 }}>
          {files.length > 0 ? `已選擇 ${files.length} 個檔案` : '拖曳 Excel 檔案到此，或點擊上傳'}
        </div>
        <div style={{ color: 'var(--text-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          支援 .xlsx、.xlsm 格式
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ margin: '1rem 0', padding: '0.8rem', background: '#FFEBEE', borderRadius: '8px', color: '#D32F2F', fontSize: '0.9rem' }}>
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

      {/* Prompt */}
      <div style={{ marginTop: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
          📝 分析需求（告訴 AI 你想要什麼）
        </label>
        <textarea
          className="textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="例如：分析台新信用卡 114 年市占率趨勢，比較前五大銀行表現，並產生管理報告..."
        />
        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          AI 會根據你的需求分析 Excel 資料，自動決定計算方式與簡報架構
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
