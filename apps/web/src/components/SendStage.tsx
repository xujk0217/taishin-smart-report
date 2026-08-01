/**
 * SendStage — 模擬寄送
 *
 * After the user approves the deck, they fill in recipients and a subject,
 * then "send." We don't send a real email; instead we log an audit record
 * to localStorage so it persists across sessions and can be shown to judges.
 */
import { useState } from 'react';

export interface AuditRecord {
  id: string;
  timestamp: string;
  recipients: string[];
  subject: string;
  slideCount: number;
  artifacts: string[];
  status: 'sent';
}

interface Props {
  slideCount: number;
  onDone: () => void;
  onBack: () => void;
}

const STORAGE_KEY = 'smart-report-audit-log';

function generateId(): string {
  return `SR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function saveAudit(record: AuditRecord) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    existing.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // silently fail for private browsing
  }
}

export function getAuditLog(): AuditRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function SendStage({ slideCount, onDone, onBack }: Props) {
  const [recipients, setRecipients] = useState('');
  const [subject, setSubject] = useState('數據分析報告');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<AuditRecord | null>(null);

  const handleSend = async () => {
    const recipientList = recipients
      .split(/[,;，；\n]/)
      .map(s => s.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      alert('請填寫至少一位收件人');
      return;
    }

    setSending(true);
    // Simulate network delay
    await new Promise(r => setTimeout(r, 1200));

    const record: AuditRecord = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      recipients: recipientList,
      subject: subject.trim() || '分析報告',
      slideCount,
      artifacts: ['report.pptx', 'evidence.xlsx'],
      status: 'sent',
    };

    saveAudit(record);
    setSent(record);
    setSending(false);
  };

  if (sent) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: '#E8F5E9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1.5rem', fontSize: '2rem',
        }}>
          ✅
        </div>
        <h2 style={{ justifyContent: 'center', color: 'var(--success)' }}>模擬寄送成功</h2>
        <p style={{ color: 'var(--text-light)', margin: '1rem auto 0', maxWidth: 500 }}>
          報告已記錄至稽核日誌。實際部署時將透過企業郵件系統發送。
        </p>

        <div style={{
          marginTop: '1.5rem', padding: '1.2rem', background: 'var(--accent)',
          borderRadius: 'var(--radius-sm)', textAlign: 'left', maxWidth: 500,
          margin: '1.5rem auto 0', fontSize: '0.82rem', lineHeight: 1.8,
        }}>
          <div><strong>稽核編號：</strong>{sent.id}</div>
          <div><strong>時間：</strong>{new Date(sent.timestamp).toLocaleString('zh-TW')}</div>
          <div><strong>收件人：</strong>{sent.recipients.join('、')}</div>
          <div><strong>主旨：</strong>{sent.subject}</div>
          <div><strong>附件：</strong>{sent.artifacts.join('、')}</div>
          <div><strong>簡報頁數：</strong>{sent.slideCount} 頁</div>
          <div><strong>狀態：</strong><span className="badge badge-success">已記錄</span></div>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={onBack}>
            返回預覽
          </button>
          <button className="btn btn-primary" onClick={onDone}>
            完成流程
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto', padding: '2rem' }}>
      <h2>📨 模擬寄送報告</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', margin: '0.3rem 0 1.5rem' }}>
        填寫收件人與主旨後，系統將記錄一筆稽核紀錄（不會真正寄出）。
      </p>

      <div style={{ marginBottom: '1.2rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
          收件人（多位以逗號分隔）
        </label>
        <textarea
          className="textarea"
          rows={3}
          placeholder="例：manager@company.com, director@company.com"
          value={recipients}
          onChange={e => setRecipients(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: '1.2rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
          郵件主旨
        </label>
        <input
          className="input"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="數據分析報告"
        />
      </div>

      <div style={{
        padding: '0.8rem 1rem', background: 'var(--accent)',
        borderRadius: 'var(--radius-sm)', fontSize: '0.78rem',
        color: 'var(--text-light)', lineHeight: 1.7, marginBottom: '1.5rem',
      }}>
        <strong>附件內容：</strong><br />
        · 數據分析報告.pptx（{slideCount} 頁，含原生圖表）<br />
        · 數據分析報告_來源附件.xlsx（含圖表資料與來源追溯）
      </div>

      <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onBack} disabled={sending}>
          返回預覽
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleSend} disabled={sending}>
          {sending ? '寄送中...' : '確認寄送'}
        </button>
      </div>
    </div>
  );
}
