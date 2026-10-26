import type { LyricLine } from './types';

export interface DetectedWord {
  text: string;
  start: number;
  end: number;
}

export interface AlignProgress {
  phase: 'status' | 'download' | 'result';
  message: string;
  value?: number;
}

export const MODELS: { id: string; label: string; size: string; note: string }[] = [
  {
    id: 'Xenova/whisper-tiny',
    label: 'whisper-tiny',
    size: '± 40 MB (q8)',
    note: 'paling ringan, akurasi kata paling kasar',
  },
  {
    id: 'Xenova/whisper-base',
    label: 'whisper-base',
    size: '± 45 MB (q8)',
    note: 'seimbang, disarankan untuk HP dan laptop',
  },
  {
    id: 'Xenova/whisper-small',
    label: 'whisper-small',
    size: '± 250 MB (q8)',
    note: 'akurasi terbaik, butuh RAM lega, lambat di HP',
  },
];

export interface AlignRun {
  promise: Promise<DetectedWord[]>;
  cancel: () => void;
}

/**
 * Real forced-ish alignment: Whisper transcribes the mix with word level timestamps,
 * then those detections are matched against the lyric text the user pasted.
 * Runs in a worker, so cancelling is a hard terminate (and frees the model memory).
 */
export function runAlignment(
  audio16k: Float32Array,
  model: string,
  language: string,
  onProgress: (p: AlignProgress) => void,
): AlignRun {
  const worker = new Worker(new URL('../workers/align.worker.ts', import.meta.url), {
    type: 'module',
  });

  let settled = false;
  const promise = new Promise<DetectedWord[]>((resolve, reject) => {
    worker.onmessage = (
      e: MessageEvent<{
        type: 'status' | 'progress' | 'result' | 'error';
        message?: string;
        file?: string;
        loaded?: number;
        total?: number;
        chunks?: { text: string; timestamp: [number, number | null] }[];
      }>,
    ) => {
      const d = e.data;
      if (d.type === 'status') {
        onProgress({ phase: 'status', message: d.message ?? '' });
        return;
      }
      if (d.type === 'progress') {
        const pct =
          d.total && d.loaded ? Math.min(100, Math.round((d.loaded / d.total) * 100)) : undefined;
        onProgress({
          phase: 'download',
          message: d.file ?? d.message ?? 'mengunduh',
          value: pct,
        });
        return;
      }
      if (d.type === 'error') {
        settled = true;
        worker.terminate();
        reject(new Error(d.message ?? 'Auto-sync gagal.'));
        return;
      }
      if (d.type === 'result') {
        settled = true;
        worker.terminate();
        const words: DetectedWord[] = (d.chunks ?? [])
          .map((c) => ({
            text: c.text.trim(),
            start: c.timestamp[0] ?? 0,
            end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3,
          }))
          .filter((w) => w.text.length > 0);
        onProgress({ phase: 'result', message: `${words.length} kata terdeteksi` });
        resolve(words);
      }
    };
    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(`Worker alignment error: ${ev.message ?? 'tidak diketahui'}`));
    };
    worker.postMessage({ audio: audio16k, model, language }, [audio16k.buffer]);
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      onProgress({ phase: 'status', message: 'dibatalkan' });
    },
  };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u00c0-\u024f\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

export interface AlignSummary {
  lines: LyricLine[];
  matchedWords: number;
  totalWords: number;
  confidence: number;
}

/**
 * Greedy sequential matching of detected words onto the pasted lyric words.
 * Lines that never matched are interpolated between their known neighbours instead of
 * being given random timestamps.
 */
export function alignLyricsToDetected(
  lines: LyricLine[],
  detected: DetectedWord[],
): AlignSummary {
  const targets: { li: number; wi: number; word: string; start: number | null }[] = [];
  lines.forEach((line, li) => {
    const words = normalize(line.text).split(' ').filter(Boolean);
    words.forEach((w, wi) => targets.push({ li, wi, word: w, start: null }));
  });

  let ti = 0;
  let matched = 0;
  for (const det of detected) {
    const dWords = normalize(det.text).split(' ').filter(Boolean);
    if (!dWords.length) continue;
    const dw = dWords[dWords.length - 1];
    let best = -1;
    let bestScore = 0;
    for (let k = 0; k < 4 && ti + k < targets.length; k++) {
      const score = similarity(dw, targets[ti + k].word);
      if (score > bestScore) {
        bestScore = score;
        best = ti + k;
      }
    }
    if (best >= 0 && bestScore >= 0.66) {
      targets[best].start = det.start;
      matched++;
      ti = best + 1;
    }
  }

  const totalWords = targets.length;
  const out = lines.map((line) => ({ ...line }));

  // per line: first matched word start, last matched word end
  for (let li = 0; li < out.length; li++) {
    const starts = targets.filter((t) => t.li === li && t.start !== null).map((t) => t.start!);
    if (starts.length) {
      out[li].start = Math.max(0, Math.min(...starts));
    } else {
      out[li].start = NaN;
    }
  }

  // interpolate unknown line starts between known neighbours
  const known = out.map((l, i) => ({ i, s: l.start })).filter((k) => Number.isFinite(k.s));
  for (let li = 0; li < out.length; li++) {
    if (Number.isFinite(out[li].start)) continue;
    const prev = [...known].reverse().find((k) => k.i < li);
    const next = known.find((k) => k.i > li);
    if (prev && next) {
      const ratio = (li - prev.i) / (next.i - prev.i);
      out[li].start = prev.s + (next.s - prev.s) * ratio;
    } else if (prev) {
      out[li].start = prev.s + (li - prev.i) * 2;
    } else if (next) {
      out[li].start = Math.max(0, next.s - (next.i - li) * 2);
    } else {
      out[li].start = li * 2;
    }
  }

  // end = next line start, last line gets a tail
  for (let li = 0; li < out.length; li++) {
    const nextStart = li + 1 < out.length ? out[li + 1].start : NaN;
    if (Number.isFinite(nextStart) && nextStart > out[li].start) {
      out[li].end = Math.max(out[li].start + 0.3, nextStart - 0.04);
    } else {
      out[li].end = out[li].start + 3;
    }
  }

  return {
    lines: out,
    matchedWords: matched,
    totalWords,
    confidence: totalWords ? matched / totalWords : 0,
  };
}
