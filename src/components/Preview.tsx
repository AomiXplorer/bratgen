import { useEffect, useRef } from 'react';
import { activeText, drawFrame } from '../lib/render';
import { ASPECT_SIZES, type LyricLine, type StyleConfig } from '../lib/types';

export default function Preview({
  style,
  lines,
  time,
}: {
  style: StyleConfig;
  lines: LyricLine[];
  time: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { w, h } = ASPECT_SIZES[style.aspect];
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFrame(ctx, w, h, style, activeText(lines, time), time);
  }, [style, lines, time]);

  const portrait = style.aspect === '9:16' || style.aspect === '4:5';

  return (
    <div className="preview-shell">
      <canvas ref={ref} className={portrait ? 'preview-canvas portrait' : 'preview-canvas'} />
    </div>
  );
}
