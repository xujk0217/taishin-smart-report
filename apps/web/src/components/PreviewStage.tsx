import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { SlideSpec } from '../types/slide-spec';
import type { ComputeResult } from '../utils/metric-engine';
import { traceElement, type ElementProvenance } from '../utils/provenance';
import { editSlide, type EditResult } from '../utils/slide-editor';
import { SlideCanvas } from './SlideCanvas';
import { DataInspector } from './DataInspector';
import { VoiceButton } from './VoiceButton';
import { useEnterSubmit } from '../utils/ime';

interface Props {
  slides: SlideSpec[];
  computeResult: ComputeResult | null;
  onExport: () => void;
  exporting: boolean;
  /** Replaces one slide after a successful natural-language edit. */
  onSlideChange?: (index: number, slide: SlideSpec) => void;
  /** Navigates to the simulated-send stage. */
  onSend?: () => void;
}

type Tab = 'slides' | 'data';

const ELEMENT_LABELS: Record<string, string> = {
  title: '主標題',
  subtitle: '副標題',
  heading: '頁面標題',
  chart: '圖表',
  text_block: '文字分析',
  bullet_list: '要點列表',
  kpi_block: '關鍵指標',
  insight: 'AI 洞察',
  comparison: '銀行比較',
  source: '來源標註',
  table: '表格',
};

const KIND_BADGE: Record<ElementProvenance['kind'], { cls: string; label: string }> = {
  computed: { cls: 'badge-success', label: '已計算' },
  narrative: { cls: 'badge-info', label: 'AI 敘述' },
  static: { cls: 'badge-warning', label: '版面' },
};

export function PreviewStage({ slides, computeResult, onExport, exporting, onSlideChange, onSend }: Props) {
  const [tab, setTab] = useState<Tab>('slides');
  const [activeSlide, setActiveSlide] = useState(0);
  const [selectedEl, setSelectedEl] = useState<number | null>(null);
  const [mainWidth, setMainWidth] = useState(760);
  const [instruction, setInstruction] = useState('');
  const [editing, setEditing] = useState(false);
  const [editFeedback, setEditFeedback] = useState<EditResult | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([]);

  const safeIdx = slides.length ? Math.min(Math.max(activeSlide, 0), slides.length - 1) : 0;
  const current = slides[safeIdx];

  // Keyboard slide navigation. Only active on the slides tab, and never while
  // the user is typing in an input.
  useEffect(() => {
    if (tab !== 'slides') return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setActiveSlide(p => Math.min(p + 1, slides.length - 1));
        setSelectedEl(null);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setActiveSlide(p => Math.max(p - 1, 0));
        setSelectedEl(null);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveSlide(slides.length - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [slides.length, tab]);

  // Keep the active thumbnail in view when navigating by keyboard.
  useEffect(() => {
    thumbRefs.current[safeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [safeIdx]);

  // Track the preview column width so the canvas can scale to fit.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => setMainWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const provenances = useMemo(
    () => (current ? current.elements.map(el => traceElement(el, computeResult)) : []),
    [current, computeResult],
  );

  // Clear stale edit feedback when moving to a different slide.
  useEffect(() => { setEditFeedback(null); }, [safeIdx]);

  const runEdit = useCallback(async () => {
    const text = instruction.trim();
    if (!text || !current || editing) return;
    setEditing(true);
    setEditFeedback(null);
    try {
      const res = await editSlide(current, text);
      setEditFeedback(res);
      if (res.ok && res.slide) {
        onSlideChange?.(safeIdx, res.slide);
        setInstruction('');
      }
    } finally {
      setEditing(false);
    }
  }, [instruction, current, editing, onSlideChange, safeIdx]);

  const editEnter = useEnterSubmit(runEdit);

  const downloadEvidence = async () => {
    setExportingXlsx(true);
    try {
      const { exportEvidenceWorkbook } = await import('../utils/xlsx-exporter');
      await exportEvidenceWorkbook(slides, computeResult);
    } catch (err: any) {
      alert('來源附件匯出失敗：' + (err?.message ?? err));
    } finally {
      setExportingXlsx(false);
    }
  };

  const downloadPdf = async () => {
    setExportingPdf(true);
    try {
      const { exportPDF } = await import('../utils/pdf-exporter');
      await exportPDF(slides, computeResult);
    } catch (err: any) {
      alert('PDF 匯出失敗：' + (err?.message ?? err));
    } finally {
      setExportingPdf(false);
    }
  };

  const downloadCsv = () => {
    try {
      // Sync import is fine since it's tiny
      import('../utils/csv-exporter').then(({ exportCSV }) => exportCSV(computeResult));
    } catch (err: any) {
      alert('CSV 匯出失敗：' + (err?.message ?? err));
    }
  };

  if (!slides.length) {
    return (
      <div className="card">
        <h2>尚無投影片</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          請回到上一步重新產生簡報內容。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ padding: '0.7rem 1.2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className={`btn btn-sm ${tab === 'slides' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('slides')}
            >
              簡報預覽
            </button>
            <button
              className={`btn btn-sm ${tab === 'data' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('data')}
            >
              資料檢視
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            {tab === 'slides' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                第 {safeIdx + 1} / {slides.length} 頁　·　↑↓ 切換
              </span>
            )}
            <button
              className="btn btn-sm btn-outline"
              onClick={downloadEvidence}
              disabled={exportingXlsx || !computeResult}
              title="匯出來源證據 Excel"
            >
              {exportingXlsx ? '...' : 'XLSX 附件'}
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={downloadPdf}
              disabled={exportingPdf}
              title="匯出簡報 PDF"
            >
              {exportingPdf ? '...' : 'PDF'}
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={downloadCsv}
              disabled={!computeResult}
              title="匯出原始數據 CSV"
            >
              CSV
            </button>
            <button className="btn btn-primary" onClick={onExport} disabled={exporting}>
              {exporting ? '匯出中...' : '匯出 PPTX'}
            </button>
            {onSend && (
              <button className="btn btn-secondary" onClick={onSend}>
                📨 模擬寄送
              </button>
            )}
          </div>
        </div>
      </div>

      {tab === 'data' ? (
        <DataInspector
          slides={slides}
          computeResult={computeResult}
          onJumpToSlide={page => {
            const idx = slides.findIndex(s => s.page === page);
            if (idx >= 0) {
              setActiveSlide(idx);
              setTab('slides');
            }
          }}
        />
      ) : (
        <div className="preview-layout">
          {/* Thumbnails: same renderer as the main canvas, scaled down */}
          <div className="slide-nav">
            {slides.map((s, i) => (
              <div
                key={i}
                ref={el => { thumbRefs.current[i] = el; }}
                className={`slide-thumb ${safeIdx === i ? 'active' : ''}`}
                onClick={() => { setActiveSlide(i); setSelectedEl(null); }}
                style={{ padding: 0, display: 'block', position: 'relative' }}
                title={`第 ${s.page} 頁`}
              >
                <SlideCanvas spec={s} computeResult={computeResult} width={164} thumbnail />
                <div style={{
                  position: 'absolute', top: 3, left: 3,
                  background: safeIdx === i ? 'var(--primary)' : 'rgba(0,0,0,0.45)',
                  color: 'white', fontSize: '0.6rem', fontWeight: 600,
                  borderRadius: 3, padding: '1px 5px', lineHeight: 1.5,
                }}>
                  {s.page}
                </div>
              </div>
            ))}
          </div>

          {/* Main canvas */}
          <div ref={mainRef} style={{ minWidth: 0 }}>
            <SlideCanvas
              spec={current}
              computeResult={computeResult}
              width={mainWidth}
              highlightIndex={selectedEl}
              onElementClick={i => setSelectedEl(selectedEl === i ? null : i)}
            />
            <div style={{
              fontSize: '0.72rem', color: 'var(--text-muted)',
              marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between',
            }}>
              <span>
                背景 {current.background}　·　版面 {current.layout}
                {current.section ? `　·　段落 ${current.section}` : ''}
              </span>
              <span>點擊投影片元素可查看計算來源</span>
            </div>

            {/* Natural-language editing, numbers are protected by validation */}
            <div style={{ marginTop: '0.8rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: '0.82rem' }}
                  placeholder="用一句話修改這一頁，例如：標題改得更精簡、要點改成三條"
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  {...editEnter}
                  disabled={editing}
                />
                <VoiceButton onResult={text => setInstruction(prev => prev + text)} />
                <button
                  className="btn btn-secondary"
                  onClick={runEdit}
                  disabled={editing || !instruction.trim()}
                >
                  {editing ? '修改中...' : 'AI 修改'}
                </button>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                可改文字敘述與排序；數值、排名、圖表資料來源受保護，變更會被擋下。
              </div>

              {editFeedback && (
                <div style={{
                  marginTop: '0.6rem', padding: '0.6rem 0.8rem', borderRadius: 6,
                  fontSize: '0.75rem', lineHeight: 1.7,
                  background: editFeedback.ok ? '#EAF7EE' : '#FFEBEE',
                  border: `1px solid ${editFeedback.ok ? '#A9DFBF' : '#F5B7B1'}`,
                }}>
                  {editFeedback.ok ? (
                    <>
                      <strong style={{ color: 'var(--success)' }}>已套用修改</strong>
                      {editFeedback.changes.length > 0 && (
                        <ul style={{ paddingLeft: '1.2rem', margin: '0.3rem 0 0' }}>
                          {editFeedback.changes.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      <strong style={{ color: 'var(--error)' }}>修改已被擋下</strong>
                      <ul style={{ paddingLeft: '1.2rem', margin: '0.3rem 0 0' }}>
                        {editFeedback.violations.map((v, i) => (
                          <li key={i}>
                            <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{v.code}</code>{' '}
                            {v.message}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Evidence panel */}
          <div className="slide-panel">
            <h3>本頁元素（{current.elements.length}）</h3>
            {current.elements.map((el, i) => {
              const prov = provenances[i];
              const open = selectedEl === i;
              const badge = KIND_BADGE[prov.kind];
              return (
                <div
                  key={i}
                  onClick={() => setSelectedEl(open ? null : i)}
                  style={{
                    padding: '0.5rem 0.6rem',
                    background: open ? '#FDEDEC' : 'var(--accent)',
                    border: open ? '1px solid var(--primary)' : '1px solid transparent',
                    borderRadius: 6,
                    marginBottom: '0.4rem',
                    cursor: 'pointer',
                    fontSize: '0.72rem',
                    transition: 'var(--transition)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    <strong style={{ fontSize: '0.72rem' }}>
                      {ELEMENT_LABELS[el.type] ?? el.type}
                    </strong>
                  </div>

                  <div style={{ color: 'var(--text-light)', lineHeight: 1.5 }}>
                    {prov.origin}
                  </div>

                  {open && (
                    <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--accent-dark)', paddingTop: '0.5rem' }}>
                      {prov.steps.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--primary)' }}>
                            計算過程
                          </div>
                          <ol style={{ paddingLeft: '1.1rem', margin: '0 0 0.5rem', lineHeight: 1.65 }}>
                            {prov.steps.map((s, j) => (
                              <li key={j} style={{ marginBottom: '0.15rem' }}>{s}</li>
                            ))}
                          </ol>
                        </>
                      )}

                      {prov.metrics.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--primary)' }}>
                            指標（{prov.metrics.length}）
                          </div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            {prov.metrics.slice(0, 5).map(m => (
                              <div key={m.metricId} style={{ marginBottom: '0.2rem', lineHeight: 1.5 }}>
                                <code style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{m.metricId}</code>{' '}
                                {m.entity} · {m.period} · <strong>{m.value}{m.unit}</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                  公式：{m.formula}
                                </div>
                              </div>
                            ))}
                            {prov.metrics.length > 5 && (
                              <div style={{ color: 'var(--text-muted)' }}>…另有 {prov.metrics.length - 5} 個</div>
                            )}
                          </div>
                        </>
                      )}

                      {prov.sources.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--primary)' }}>
                            原始儲存格（{prov.sources.length}）
                          </div>
                          <div style={{
                            maxHeight: 150, overflowY: 'auto',
                            background: 'white', borderRadius: 4, padding: '0.3rem',
                          }}>
                            {prov.sources.slice(0, 20).map(s => (
                              <div key={s.sourceId} style={{ fontSize: '0.65rem', lineHeight: 1.6, display: 'flex', gap: '0.3rem' }}>
                                <code style={{ color: 'var(--info)', flexShrink: 0 }}>
                                  {s.sheetName}!{s.cellAddress}
                                </code>
                                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.entity} {s.period} = {s.rawValue}
                                </span>
                              </div>
                            ))}
                            {prov.sources.length > 20 && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                …另有 {prov.sources.length - 20} 個儲存格
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {computeResult && (
              <div style={{
                marginTop: '0.8rem', paddingTop: '0.6rem',
                borderTop: '1px solid var(--border)',
                fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.7,
              }}>
                全份簡報共引用 {computeResult.sourceRefs.length} 個儲存格
                、{computeResult.metrics.length} 個計算指標。
                <button
                  className="btn btn-sm btn-outline"
                  style={{ marginTop: '0.4rem', width: '100%' }}
                  onClick={() => setTab('data')}
                >
                  查看完整資料表
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
