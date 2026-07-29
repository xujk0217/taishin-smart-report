/**
 * Brand design tokens for 台新新光金控 (Taishin Shinko Financial Holdings).
 * Extracted from 附件一_台新新光金控簡報版型.pptx
 */
export const BRAND_TOKENS = {
  /** Slide dimensions */
  slide: {
    width: 10, // inches (16:9 widescreen)
    height: 5.625, // inches
  },

  /** Color palette */
  colors: {
    primary: 'C01B2B', // Taishin Red
    primaryDark: '8B0000', // Dark Red
    secondary: 'FFFFFF', // White
    accent: 'E8E8E8', // Light Gray
    text: '333333', // Dark text
    textLight: '666666', // Secondary text
    background: 'FFFFFF',
    gradientStart: 'C01B2B', // Red gradient start
    gradientEnd: 'E85050', // Red gradient end
    chartColors: [
      'C01B2B', // Taishin Red
      '2E5090', // Blue
      '4CAF50', // Green
      'FF9800', // Orange
      '9C27B0', // Purple
      '00BCD4', // Cyan
      'F44336', // Light Red
      '3F51B5', // Indigo
    ],
  },

  /** Typography */
  fonts: {
    title: '微軟正黑體',
    body: '微軟正黑體',
    titleSize: 28,
    subtitleSize: 18,
    bodySize: 12,
    captionSize: 9,
    chartLabelSize: 10,
  },

  /** Logo */
  logo: {
    path: '', // Will be set to actual logo file path
    width: 1.5, // inches
    height: 0.5,
    x: 0.3,
    y: 0.2,
  },

  /** Layout constants */
  layout: {
    marginLeft: 0.5,
    marginRight: 0.5,
    marginTop: 0.8,
    marginBottom: 0.4,
    titleY: 0.3,
    contentY: 1.0,
    footerY: 5.2,
  },
} as const;

export type BrandTokens = typeof BRAND_TOKENS;
