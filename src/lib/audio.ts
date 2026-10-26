import type { AudioMeta } from './types';

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export async function resumeAudio(): Promise<void> {
  const c = audioCtx();
  if (c.state === 'suspended') await c.resume();
}

/** Decode a user picked audio file entirely in the browser. Nothing is uploaded. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const buf = await file.arrayBuffer();
  const decoded = await audioCtx().decodeAudioData(buf);
  if (decoded.duration <= 0) throw new Error('File audio tidak berisi data yang bisa didekode.');
  return decoded;
}

export function metaFrom(file: File, buffer: AudioBuffer): AudioMeta {
  return {
    name: file.name,
    duration: buffer.duration,
    size: file.size,
    type: file.type || 'audio/*',
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  };
}

/** Mono mixdown, resampled to 16 kHz: the input format the alignment model expects. */
export function mono16k(buffer: AudioBuffer): Float32Array {
  const target = 16000;
  const chCount = buffer.numberOfChannels;
  const srcLength = buffer.length;
  const src = new Float32Array(srcLength);
  for (let ch = 0; ch < chCount; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < srcLength; i++) src[i] += data[i] / chCount;
  }
  if (buffer.sampleRate === target) return src;

  const ratio = buffer.sampleRate / target;
  const outLength = Math.floor(srcLength / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, srcLength - 1);
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

export type Peaks = { min: Float32Array; max: Float32Array };

/** Waveform peaks computed off the main thread when a worker is available. */
export function computePeaks(buffer: AudioBuffer, buckets = 1200): Promise<Peaks> {
  const chCount = buffer.numberOfChannels;
  const src = new Float32Array(buffer.length);
  for (let ch = 0; ch < chCount; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) src[i] += data[i] / chCount;
  }

  try {
    const worker = new Worker(new URL('../workers/peaks.worker.ts', import.meta.url), { type: 'module' });
    return new Promise<Peaks>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ min: Float32Array; max: Float32Array }>) => {
        worker.terminate();
        resolve({ min: e.data.min, max: e.data.max });
      };
      worker.onerror = () => {
        worker.terminate();
        try {
          resolve(peaksInline(src, buckets));
        } catch (err) {
          reject(err);
        }
      };
      worker.postMessage({ samples: src, buckets }, [src.buffer]);
    });
  } catch {
    return Promise.resolve(peaksInline(src, buckets));
  }
}

export function peaksInline(samples: Float32Array, buckets: number): Peaks {
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    let lo = 0;
    let hi = 0;
    const start = b * size;
    const end = Math.min(start + size, samples.length);
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/** Resample an AudioBuffer to 48 kHz stereo, the layout used for AAC encoding. */
export async function to48kStereo(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.sampleRate === 48000 && buffer.numberOfChannels === 2) return buffer;
  const length = Math.ceil(buffer.duration * 48000);
  const offline = new OfflineAudioContext(2, length, 48000);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return offline.startRendering();
}

export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
