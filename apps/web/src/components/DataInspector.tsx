/**
 * DataInspector shows every value that was read out of the uploaded Excel
 * files, and for any cell you click, explains exactly which metrics were
 * derived from it, how they were computed, and which slides use them.
 */
import { useMemo, useState } from 'react';
import type { SlideSpec } from '../types/slide-spec';
import type { ComputeResult, SourceRef } from '../utils/metric-engine';
import { buildDataTables, traceSourceUsage } from '../utils/provenance';

interface Props {
  slides: SlideSpec[];
  computeResult: ComputeResult | null;
  onJumpToSlide: (page: number) => void;
}

export function DataInspector({ slides, computeResult, onJumpToSlide }: Props) {
  const tables = useMemo(() => buildDataTables(computeResult), [computeResult]);
  const [tableIdx, setTableIdx] = useState(0);
  const [selected, setSelected] = useState<SourceRef | null>(null);
  const [filter, setFilter] = useState('');

  const usage = useMemo(
    () => (selected ? traceSourceUsage(selected, slides, computeResult) : null),
    [selected, slides, computeResult],
  );

  if (!computeResult || tables.length === 0) {
    return (
      <div className="card">
        <h2>資料檢視</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          尚未讀取到可追溯的數據。請確認上傳的 Excel 含有期間欄位（例如 11401）。
        </p>
      </div>
    );
  }

  const table = tables[Math.min(tableIdx, tables.length - 1)];
  const visibleRows = filter
    ? table.rows.filter(r => r.entity.includes(filter))
    : table.rows;

  return (
    <>
      <div className="card" style={{ padding: '0.9rem 1.2rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          <Stat label="工作表" value={computeResult.summary.sheetsUsed} />
          <Stat label="實體" value={computeResult.summary.totalEntities} />
          <Stat label="期間" value={computeResult.summary.totalPeriods} />
          <Stat label="原始儲存格" value={computeResult.sourceRefs.length} />
          <Stat label="計算指標" value={computeResult.metrics.length} />
          <Stat label="圖表" value={computeResult.charts.length} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1rem', alignItems: 'start' }}>
        <div className="card" style={{ padding: '1rem', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 'auto', flex: '1 1 240px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              value={tableIdx}
              onChange={e => { setTableIdx(Number(e.target.value)); setSelected(null); }}
            >
              {tables.map((t, i) => (
                <option key={i} value={i}>
                  {t.sheetName}（{t.rows.length} 列 × {t.periods.length} 期）
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 'auto', flex: '0 1 160px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              placeholder="篩選實體"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            來源檔案：{table.fileName}　·　點擊任一數值查看計算過程
          </div>

          <div style={{ overflow: 'auto', maxHeight: 460 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, top: 0, zIndex: 2,
                    background: 'var(--primary)', color: 'white',
                    padding: '0.4rem 0.6rem', textAlign: 'left', whiteSpace: 'nowrap',
                  }}>
                    實體
                  </th>
                  {table.periods.map(p => (
                    <th key={p} style={{
                      position: 'sticky', top: 0, zIndex: 1,
                      background: 'var(--primary)', color: 'white',
                      padding: '0.4rem 0.5rem', whiteSpace: 'nowrap', fontWeight: 600,
                    }}>
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr key={row.entity} style={{ background: i % 2 ? '#FAFAFA' : 'white' }}>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 1,
                      background: i % 2 ? '#FAFAFA' : 'white',
                      padding: '0.35rem 0.6rem', fontWeight: 600,
                      whiteSpace: 'nowrap', borderRight: '1px solid var(--border)',
                    }}>
                      {row.entity}
                    </td>
                    {row.cells.map((cell, j) => {
                      const isSel = cell && selected?.sourceId === cell.sourceId;
                      return (
                        <td
                          key={j}
                          onClick={() => cell && setSelected(isSel ? null : cell)}
                          title={cell ? `${cell.sheetName}!${cell.cellAddress}` : ''}
                          style={{
                            padding: '0.35rem 0.5rem',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                            cursor: cell ? 'pointer' : 'default',
                            background: isSel ? 'var(--primary)' : undefined,
                            color: isSel ? 'white' : cell ? 'var(--text)' : 'var(--text-muted)',
                            fontWeight: isSel ? 700 : 400,
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          {cell ? cell.rawValue : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Explanation panel */}
        <div className="card" style={{ padding: '1rem', maxHeight: 560, overflowY: 'auto' }}>
          {!selected || !usage ? (
            <>
              <h3 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.6rem' }}>
                計算說明
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                點擊左側表格中的任一數值，這裡會顯示：
              </p>
              <ul style={{ fontSize: '0.75rem', color: 'var(--text-light)', paddingLeft: '1.2rem', lineHeight: 1.9 }}>
                <li>該儲存格的確切位置</li>
                <li>由它算出哪些指標</li>
                <li>完整計算式與代入的數字</li>
                <li>用在簡報的哪幾頁、哪些圖表</li>
              </ul>

              <div style={{ marginTop: '1rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '0.5rem' }}>
                  本份簡報使用的公式
                </h3>
                {[...new Set(computeResult.metrics.map(m => m.formula))].slice(0, 8).map((f, i) => (
                  <div key={i} style={{
                    fontSize: '0.7rem', background: 'var(--accent)', borderRadius: 4,
                    padding: '0.35rem 0.5rem', marginBottom: '0.3rem', lineHeight: 1.5,
                  }}>
                    {f}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.6rem' }}>
                {selected.entity}　{selected.period}
              </h3>

              <Section title="① 原始資料位置">
                <div style={{ fontSize: '0.72rem', lineHeight: 1.8 }}>
                  <div>檔案：{selected.fileName}</div>
                  <div>工作表：{selected.sheetName}</div>
                  <div>
                    儲存格：<code style={{ color: 'var(--info)' }}>{selected.cellAddress}</code>
                  </div>
                  <div>
                    原始值：<strong>{selected.rawValue}</strong>
                    {selected.value !== Number(selected.rawValue) && (
                      <span style={{ color: 'var(--text-muted)' }}>（解析為 {selected.value}）</span>
                    )}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                    來源編號 {selected.sourceId}
                  </div>
                </div>
              </Section>

              <Section title={`② 由此算出的指標（${usage.metricNames.length}）`}>
                {usage.metricNames.length === 0 ? (
                  <Empty>此儲存格未被任何指標引用（可能是標題列或空白欄）</Empty>
                ) : (
                  usage.metricNames.slice(0, 8).map((n, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', lineHeight: 1.7 }}>· {n}</div>
                  ))
                )}
              </Section>

              <Section title="③ 計算過程">
                {usage.steps.length === 0 ? (
                  <Empty>無</Empty>
                ) : (
                  usage.steps.map((s, i) => (
                    <div key={i} style={{
                      fontSize: '0.7rem', background: 'var(--accent)', borderRadius: 4,
                      padding: '0.35rem 0.5rem', marginBottom: '0.3rem', lineHeight: 1.6,
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      {s}
                    </div>
                  ))
                )}
              </Section>

              <Section title={`④ 使用於圖表（${usage.chartTitles.length}）`}>
                {usage.chartTitles.length === 0 ? (
                  <Empty>未用於圖表</Empty>
                ) : (
                  usage.chartTitles.map((t, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', lineHeight: 1.7 }}>📊 {t}</div>
                  ))
                )}
              </Section>

              <Section title={`⑤ 出現在簡報頁面（${usage.pages.length}）`}>
                {usage.pages.length === 0 ? (
                  <Empty>此數值未直接出現在簡報中</Empty>
                ) : (
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {usage.pages.map(p => (
                      <button
                        key={p}
                        className="btn btn-sm btn-outline"
                        style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
                        onClick={() => onJumpToSlide(p)}
                      >
                        第 {p} 頁
                      </button>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 600, color: 'var(--primary)',
        marginBottom: '0.35rem',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
      {children}
    </div>
  );
}
