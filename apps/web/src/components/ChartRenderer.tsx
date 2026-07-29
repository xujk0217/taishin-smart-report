/**
 * ChartRenderer - renders Chart.js charts. Designed to be used with key prop
 * so each slide gets a fresh mount (avoids stale chart issues).
 */
import { useRef, useEffect } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler,
  LineController, BarController,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, LineController, BarController);

const COLORS = ['#C0392B', '#2980B9', '#27AE60', '#F39C12', '#8E44AD', '#16A085'];

interface Props {
  chartData: {
    chartId?: string;
    title?: string;
    type: 'line' | 'bar';
    categories?: string[];
    series?: { name: string; data: number[]; color?: string }[];
  };
  height?: number;
  /** Thumbnail mode: no animation, no tooltips, smaller ticks. */
  compact?: boolean;
}

export function ChartRenderer({ chartData, height = 200, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !chartData?.categories?.length || !chartData?.series?.length) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Destroy old
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    chartInstance.current = new ChartJS(ctx, {
      type: chartData.type,
      data: {
        labels: chartData.categories,
        datasets: chartData.series.map((s, i) => ({
          label: s.name,
          data: s.data,
          borderColor: s.color || COLORS[i % COLORS.length],
          backgroundColor: chartData.type === 'bar'
            ? (s.color || COLORS[i % COLORS.length])
            : (s.color || COLORS[i % COLORS.length]) + '20',
          fill: chartData.type === 'line',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: chartData.type === 'line' ? 2 : 0,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: compact ? false : undefined,
        devicePixelRatio: compact ? 1 : undefined,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: compact ? 13 : 15 }, boxWidth: compact ? 10 : 14, padding: 8 },
          },
          tooltip: {
            enabled: !compact,
            callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` },
          },
        },
        scales: {
          x: {
            ticks: { font: { size: compact ? 12 : 14 }, maxRotation: 45 },
            grid: { display: false },
          },
          y: {
            ticks: { font: { size: compact ? 12 : 14 }, callback: (v) => v + '%' },
            grid: { color: '#eee' },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [chartData, compact]);

  if (!chartData?.categories?.length || !chartData?.series?.length) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>📊 載入中...</div>;
  }

  return <div style={{ height, position: 'relative' }}><canvas ref={canvasRef} /></div>;
}
