/**
 * Detailed Slide Spec - AI outputs this JSON structure.
 * Each slide has a background template, layout type, and multiple elements.
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

export interface SlideElement {
  type: ElementType;
  content?: string;
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
