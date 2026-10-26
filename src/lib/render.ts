import type { LyricLine, StyleConfig } from './types';

export function activeText(lines: LyricLine[], t: number): string {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (t >= l.start && t < l.end) return l.text;
  }
  return '';
}

export function wrapText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rows: string[] = [];
  let row = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${row} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      row = candidate;
    } else {
      rows.push(row);
      row = words[i];
    }
  }
  rows.push(row);
  return rows;
}

/**
 * Draws one video frame. Used by the live preview and by the exporter, so the exported
 * video is literally the same rendering path the user sees.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  style: StyleConfig,
  text: string,
  t: number,
): void {
  const scale = h / 1080;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const body = style.uppercase ? text.toUpperCase() : text;
  if (!body.trim()) return;

  const fontSize = Math.max(12, style.sizeRatio * Math.min(w, h));
  ctx.save();
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.fg;

  const maxWidth = w * 0.84;
  const rows = wrapText(ctx, body, maxWidth);
  const lineHeight = fontSize * 1.06;
  const blockHeight = rows.length * lineHeight;

  const wobble = Math.max(0, Math.min(1, style.wobble));
  const rotate = Math.sin(t * 1.9) * 0.012 * wobble;
  const jx = Math.sin(t * 3.1) * 5 * wobble * scale;
  const jy = Math.cos(t * 2.3) * 5 * wobble * scale;

  const blurPx = Math.max(0, style.blur) * scale;
  if (blurPx > 0.05) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;

  ctx.translate(w / 2 + jx, h / 2 + jy);
  if (rotate !== 0) ctx.rotate(rotate);

  rows.forEach((row, i) => {
    const y = -blockHeight / 2 + lineHeight * (i + 0.5);
    ctx.fillText(row, 0, y, maxWidth);
  });

  ctx.restore();
}

export function drawPlaceholder(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  message: string,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8ace00';
  ctx.font = `600 ${Math.round(h * 0.035)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, w / 2, h / 2, w * 0.8);
  ctx.restore();
}
