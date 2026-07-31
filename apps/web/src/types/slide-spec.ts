/**
 * Detailed Slide Spec - AI outputs this JSON structure.
 * Each slide has a background template, layout type, and multiple elements.
 *
 * Layout philosophy: pages target ~80% area coverage. Elements carry a `size`
 * hint so the renderer and the AI can reason about how much space each one
 * consumes. When total area would exceed ~85%, the content should be split
 * across pages. When below ~60%, elements should be enlarged or more analysis
 * added.
 */

export type BackgroundTemplate = '001' | '002' | '003';
// 001 = 封面/段落標題 (brand decorative)
// 002 = 內文/圖表 (clean white for data)
// 003 = 封底

export type LayoutType = 'cover' | 'toc' | 'section_title' | 'content' | 'backcover';

export type ElementType =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'chart'
  | 'text_block'
  | 'bullet_list'
  | 'kpi_block'
  | 'insight'
  | 'source'
  | 'comparison'
  | 'table';

/**
 * How much of the page this element should occupy (approximate area fraction).
 *   small  ≈ 10-15% (a one-line insight, a source footnote)
 *   medium ≈ 20-35% (a KPI row, a 3-bullet list, a text paragraph)
 *   large  ≈ 40-60% (a chart, a 6-row table, a multi-bank comparison)
 *   full   ≈ 70-90% (a chart that IS the page, a large data table)
 */
export type ElementSize = 'small' | 'medium' | 'large' | 'full';

export interface SlideElement {
  type: ElementType;
  content?: string;
  /** Layout hint: how much of the page this element should fill. */
  size?: ElementSize;
  position?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'main' | 'full';
  // Chart specific
  chartType?: 'line' | 'bar' | 'pie';
  dataKey?: string;
  // Bullet list
  items?: string[];
  // KPI block
  metrics?: { label: string; value: string; rank?: number; trend?: string }[];
  // Comparison
  entities?: { name: string; value: string; highlight?: boolean }[];
  // Table
  headers?: string[];
  rows?: string[][];
}

export interface SlideSpec {
  page: number;
  background: BackgroundTemplate;
  layout: LayoutType;
  section?: string;
  elements: SlideElement[];
}

export interface PresentationSpec {
  title: string;
  slides: SlideSpec[];
  metadata: {
    totalPages: number;
    dataSource: string;
    generatedAt: string;
  };
}
