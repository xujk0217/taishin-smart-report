/**
 * SlideCanvas renders one slide at a fixed logical size (1280x720) and then
 * scales the whole thing with a CSS transform to fit whatever box it's given.
 *
 * Because the main preview and the sidebar thumbnails both render through this
 * component, a thumbnail is a true scaled copy of the slide rather than a
 * separate simplified rendering.
 */
import { useEffect, useRef, useState } from 'react';
import type { SlideSpec, SlideElement } from '../types/slide-spec';
import type { ComputeResult } from '../utils/metric-engine';
import { resolveChart } from '../utils/provenance';
import { ChartRenderer } from './ChartRenderer';

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

const BG_MAP: Record<string, string> = {
  '001': '',  // Brand decorative — rendered as gradient (no image dependency)
  '002': '',  // Clean white — no background image needed
  '003': '',  // Back cover — rendered as gradient (no image dependency)
};

interface Props {
  spec: SlideSpec;
  computeResult: ComputeResult | null;
  /** Rendered width in px; height follows the 16:9 ratio. */
  width: number;
  /** Skip charts and interactivity for cheap thumbnail rendering. */
  thumbnail?: boolean;
  /** Index of the element to highlight, if any. */
  highlightIndex?: number | null;
  onElementClick?: (index: number) => void;
}

export function SlideCanvas({
  spec, computeResult, width, thumbnail = false, highlightIndex = null, onElementClick,
}: Props) {
  const scale = width / CANVAS_W;
  const centered = spec.layout === 'cover' || spec.layout === 'section_title' || spec.layout === 'backcover';
  const onDark = spec.background !== '002';

  // Background styles: gradient for brand pages, white for content
  const bgStyle: React.CSSProperties = spec.background === '002'
    ? { background: '#FFFFFF' }
    : spec.background === '003'
      ? { background: 'linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)' }
      : { background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 50%, #BFDBFE 100%)' };

  return (
    <div
      style={{
        width,
        height: width * (CANVAS_H / CANVAS_W),
        overflow: 'hidden',
        position: 'relative',
        borderRadius: thumbnail ? 4 : 8,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
          ...bgStyle,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: centered ? 'center' : 'flex-start',
          alignItems: centered ? 'center' : 'stretch',
          padding: centered ? '60px 70px' : '44px 56px 40px',
        }}
      >
        {centered ? (
          <CenteredLayout spec={spec} onDark={onDark} />
        ) : (
          <ContentLayout
            spec={spec}
            computeResult={computeResult}
            thumbnail={thumbnail}
            highlightIndex={highlightIndex}
            onElementClick={onElementClick}
          />
        )}

        {spec.layout !== 'cover' && (
          <div
            style={{
              position: 'absolute',
              right: 60,
              bottom: 26,
              fontSize: 15,
              color: onDark ? 'rgba(255,255,255,0.85)' : '#9AA5A8',
            }}
          >
            {spec.page}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Centered layout: cover / section title / back cover ─────

function CenteredLayout({ spec, onDark }: { spec: SlideSpec; onDark: boolean }) {
  const title = spec.elements.find(e => e.type === 'title');
  const subtitle = spec.elements.find(e => e.type === 'subtitle');
  const extras = spec.elements.filter(e => e.type !== 'title' && e.type !== 'subtitle');
  // Backcover (003) has dark background → white text; others → dark text
  const isDarkBg = spec.background === '003';
  const titleColor = isDarkBg ? '#FFFFFF' : '#1F2937';
  const subColor = isDarkBg ? 'rgba(255,255,255,0.8)' : '#4B5563';

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 18,
      }}
    >
      <div
        style={{
          fontSize: spec.layout === 'cover' ? 54 : 46,
          fontWeight: 800,
          color: titleColor,
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
        }}
      >
        {title?.content ?? spec.section ?? ''}
      </div>

      {subtitle?.content && (
        <div
          style={{
            fontSize: 22,
            color: subColor,
            fontWeight: 400,
          }}
        >
          {subtitle.content}
        </div>
      )}

      {extras.map((el, i) => (
        <div key={i} style={{ fontSize: 19, color: '#333', opacity: 0.92, maxWidth: 880 }}>
          {el.type === 'bullet_list'
            ? el.items?.join('　·　')
            : el.content}
        </div>
      ))}
    </div>
  );
}

// ─── Content layout ──────────────────────────────────────────

function ContentLayout({
  spec, computeResult, thumbnail, highlightIndex, onElementClick,
}: {
  spec: SlideSpec;
  computeResult: ComputeResult | null;
  thumbnail: boolean;
  highlightIndex: number | null;
  onElementClick?: (index: number) => void;
}) {
  const heading = spec.elements.find(e => e.type === 'heading');
  const headingIdx = heading ? spec.elements.indexOf(heading) : -1;
  const rest = spec.elements
    .map((el, i) => ({ el, i }))
    .filter(({ i }) => i !== headingIdx);

  const chartEntry = rest.find(({ el }) => el.type === 'chart');
  const sidebarEntries = rest.filter(
    ({ el }) => el.type === 'kpi_block' || el.type === 'comparison',
  );
  const useSidebar = Boolean(chartEntry) && sidebarEntries.length > 0;
  const belowEntries = useSidebar
    ? rest.filter(e => e !== chartEntry && !sidebarEntries.includes(e))
    : rest;

  const wrap = (index: number, node: React.ReactNode) => (
    <div
      key={index}
      onClick={onElementClick ? () => onElementClick(index) : undefined}
      style={{
        cursor: onElementClick ? 'pointer' : 'default',
        outline: highlightIndex === index ? '3px solid #3B82F6' : 'none',
        outlineOffset: 4,
        borderRadius: 6,
      }}
    >
      {node}
    </div>
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {heading && (
        <div style={{ flexShrink: 0 }}>
          {wrap(headingIdx, <ElementView el={heading} computeResult={computeResult} thumbnail={thumbnail} />)}
        </div>
      )}

      {useSidebar ? (
        <>
          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
            <div style={{ flex: '0 0 58%', minWidth: 0 }}>
              {wrap(
                chartEntry!.i,
                <ElementView el={chartEntry!.el} computeResult={computeResult} thumbnail={thumbnail} chartHeight={260} />,
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              {sidebarEntries.map(({ el, i }) =>
                wrap(i, <ElementView el={el} computeResult={computeResult} thumbnail={thumbnail} vertical />),
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            {belowEntries.map(({ el, i }) =>
              wrap(i, <ElementView el={el} computeResult={computeResult} thumbnail={thumbnail} />),
            )}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
          {rest.map(({ el, i }) =>
            wrap(i, <ElementView el={el} computeResult={computeResult} thumbnail={thumbnail} />),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Element renderer ────────────────────────────────────────

function ElementView({
  el, computeResult, thumbnail, vertical = false, chartHeight,
}: {
  el: SlideElement;
  computeResult: ComputeResult | null;
  thumbnail: boolean;
  vertical?: boolean;
  chartHeight?: number;
}) {
  switch (el.type) {
    case 'title':
      return (
        <div style={{ fontSize: 34, fontWeight: 800, color: '#3B82F6', lineHeight: 1.25 }}>
          {el.content}
        </div>
      );

    case 'subtitle':
      return <div style={{ fontSize: 21, color: '#7F8C8D' }}>{el.content}</div>;

    case 'heading':
      return (
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#3B82F6', lineHeight: 1.3 }}>
            {el.content}
          </div>
          <div style={{ width: 150, height: 4, background: '#3B82F6', marginTop: 8, borderRadius: 2 }} />
        </div>
      );

    case 'chart': {
      const chart = resolveChart(el.dataKey, computeResult);
      const h = chartHeight ?? (el.size === 'full' ? 420 : el.size === 'large' ? 320 : 240);
      if (!chart) {
        return (
          <div style={{
            height: h, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.72)', borderRadius: 10,
            color: '#95A5A6', fontSize: 20,
          }}>
            尚無圖表資料
          </div>
        );
      }
      return (
        <div style={{ background: 'rgba(255,255,255,0.86)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#2C3E50', marginBottom: 6 }}>
            {chart.title}
          </div>
          <ChartRenderer
            key={`${chart.chartId}-${thumbnail ? 'thumb' : 'main'}`}
            chartData={chart}
            height={h}
            compact={thumbnail}
          />
        </div>
      );
    }

    case 'text_block':
      return (
        <div style={{ fontSize: 17, lineHeight: 1.55, color: '#2C3E50' }}>
          {el.content}
        </div>
      );

    case 'bullet_list':
      return (
        <ul style={{ paddingLeft: 34, margin: 0, fontSize: 16, lineHeight: 1.55, color: '#2C3E50' }}>
          {el.items?.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );

    case 'kpi_block':
      return (
        <div style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          gap: 12,
          flexWrap: vertical ? 'nowrap' : 'wrap',
        }}>
          {el.metrics?.map((m, i) => (
            <div key={i} style={{
              background: '#EFF6FF',
              border: '2px solid #93C5FD',
              borderRadius: 10,
              padding: '8px 14px',
              textAlign: 'center',
              flex: vertical ? '0 0 auto' : '1 1 0',
              minWidth: vertical ? 0 : 150,
            }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#3B82F6', lineHeight: 1.15 }}>
                {m.value}
              </div>
              <div style={{ fontSize: 16, color: '#7F8C8D', marginTop: 2 }}>
                {m.label}{m.rank ? ` #${m.rank}` : ''}{m.trend ?? ''}
              </div>
            </div>
          ))}
        </div>
      );

    case 'insight':
      return (
        <div style={{
          background: '#EAF7EE',
          borderLeft: '5px solid #27AE60',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 19,
          lineHeight: 1.7,
          color: '#2C3E50',
        }}>
          💡 {el.content}
        </div>
      );

    case 'comparison':
      return (
        <div style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          gap: 8,
          flexWrap: vertical ? 'nowrap' : 'wrap',
        }}>
          {el.entities?.map((e, i) => (
            <div key={i} style={{
              padding: '9px 14px',
              borderRadius: 8,
              fontSize: 18,
              background: e.highlight ? '#EFF6FF' : '#F4F6F6',
              border: e.highlight ? '2px solid #3B82F6' : '1px solid #D5DBDB',
              color: e.highlight ? '#3B82F6' : '#2C3E50',
              fontWeight: e.highlight ? 700 : 400,
              flex: vertical ? '0 0 auto' : '1 1 0',
              textAlign: 'center',
              minWidth: 0,
            }}>
              <div style={{ fontSize: 16, opacity: 0.8 }}>{e.name}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{e.value}</div>
            </div>
          ))}
        </div>
      );

    case 'table':
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 17 }}>
          <thead>
            <tr>
              {el.headers?.map((h, i) => (
                <th key={i} style={{
                  background: '#C0392B', color: 'white', padding: '8px 10px',
                  textAlign: 'left', fontWeight: 600,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {el.rows?.map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? '#F8F9F9' : 'white' }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: '7px 10px', borderBottom: '1px solid #E5E8E8' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'source':
      return (
        <div style={{ fontSize: 15, color: '#95A5A6', fontStyle: 'italic' }}>
          資料來源：{el.content}
        </div>
      );

    default:
      return <div style={{ fontSize: 18, color: '#7F8C8D' }}>{el.content ?? ''}</div>;
  }
}
