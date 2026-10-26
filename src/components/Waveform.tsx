import { useEffect, useRef } from 'react';
import type { Peaks } from '../lib/audio';
import type { LyricLine } from '../lib/types';

const H = 96;

export default function Waveform({
  peaks,
  duration,
  playhead,
  lines,
  onSeek,
}: {
  peaks: Peaks | null;
  duration: number;
  playhead: number;
  lines: LyricLine[];
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 600;
    if (canvas.width !== Math.round(cssWidth * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, w, h);

    if (peaks && peaks.max.length) {
      const mid = h / 2;
      const bars = peaks.max.length;
      const barW = w / bars;
      ctx.fillStyle = '#3c4a20';
      for (let i = 0; i < bars; i++) {
        const top = mid - peaks.max[i] * mid * 0.95;
        const bottom = mid - peaks.min[i] * mid * 0.95;
        ctx.fillRect(i * barW, top, Math.max(1, barW), Math.max(1, bottom - top));
      }
    }

    if (duration > 0) {
      // line markers
      ctx.fillStyle = 'rgba(138, 206, 0, 0.5)';
      for (const l of lines) {
        const x = (l.start / duration) * w;
        ctx.fillRect(x, 0, Math.max(1, dpr), h * 0.35);
      }
      // playhead
      const px = (Math.min(playhead, duration) / duration) * w;
      ctx.fillStyle = '#8ace00';
      ctx.fillRect(px - dpr, 0, dpr * 2, h);
    }
  }, [peaks, duration, playhead, lines]);

  return (
    <div className="wave-wrap">
      <canvas
        ref={ref}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          if (duration > 0) onSeek(Math.max(0, Math.min(duration, ratio * duration)));
        }}
      />
    </div>
  );
}
