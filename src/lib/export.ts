import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { activeText, drawFrame } from './render';
import { to48kStereo } from './audio';
import { ASPECT_SIZES, type LyricLine, type StyleConfig } from './types';

export interface Caps {
  webcodecs: boolean;
  avc: boolean;
  aac: boolean;
  mp4: boolean;
  webm: boolean;
  videoCodec: string | null;
  notes: string[];
}

/** Probe real browser support instead of assuming it. */
export async function probeCapabilities(style: StyleConfig): Promise<Caps> {
  const { w, h } = ASPECT_SIZES[style.aspect];
  const notes: string[] = [];
  const hasWebCodecs = typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
  let videoCodec: string | null = null;

  if (!hasWebCodecs) {
    notes.push('WebCodecs tidak tersedia di browser ini.');
  } else {
    const candidates = ['avc1.42E02A', 'avc1.4D402A', 'avc1.64002A', 'avc1.42001F', 'avc1.4D401F'];
    for (const codec of candidates) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width: w,
          height: h,
          bitrate: 6_000_000,
          framerate: style.fps,
        });
        if (res.supported) {
          videoCodec = codec;
          break;
        }
      } catch {
        /* try the next codec */
      }
    }
    if (!videoCodec) notes.push('Encoder H.264 (AVC) tidak tersedia.');
  }

  let aac = false;
  if (typeof window !== 'undefined' && 'AudioEncoder' in window) {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192_000,
      });
      aac = Boolean(res.supported);
    } catch {
      aac = false;
    }
    if (!aac) notes.push('Encoder AAC tidak tersedia, audio MP4 tidak bisa dibuat.');
  } else {
    notes.push('AudioEncoder tidak tersedia di browser ini.');
  }

  const webm =
    typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].some((m) =>
      MediaRecorder.isTypeSupported(m),
    );
  if (!webm) notes.push('MediaRecorder WebM tidak tersedia.');

  return {
    webcodecs: hasWebCodecs,
    avc: Boolean(videoCodec),
    aac,
    mp4: Boolean(videoCodec) && aac,
    webm,
    videoCodec,
    notes,
  };
}

export interface ExportOptions {
  audio: AudioBuffer;
  lines: LyricLine[];
  style: StyleConfig;
  signal: AbortSignal;
  onProgress: (phase: string, value: number) => void;
}

function abortError(): Error {
  return new DOMException('Export dibatalkan', 'AbortError');
}

function makeCanvas(w: number, h: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D tidak tersedia.');
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia.');
  return { canvas, ctx };
}

const IDLE = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Client side MP4 export: WebCodecs H.264 + AAC muxed by mp4-muxer.
 * Frames are rendered one at a time and released immediately, so memory stays flat
 * regardless of song length. No SharedArrayBuffer, so no COOP/COEP headers needed.
 */
export async function exportMp4(opts: ExportOptions): Promise<Blob> {
  const { audio, lines, style, signal, onProgress } = opts;
  const { w, h } = ASPECT_SIZES[style.aspect];
  const fps = style.fps;
  const duration = audio.duration;
  const totalFrames = Math.max(1, Math.ceil(duration * fps));

  onProgress('menyiapkan encoder', 0.02);
  const caps = await probeCapabilities(style);
  if (!caps.mp4 || !caps.videoCodec) {
    throw new Error('MP4 tidak didukung jalur encoder browser ini: ' + caps.notes.join(' '));
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: w, height: h, frameRate: fps },
    audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
    fastStart: 'in-memory',
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  videoEncoder.configure({
    codec: caps.videoCodec,
    width: w,
    height: h,
    bitrate: Math.round(w * h * fps * 0.12),
    framerate: fps,
    latencyMode: 'quality',
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 192_000,
  });

  const { canvas, ctx } = makeCanvas(w, h);

  try {
    // 1. audio (resampled once, fed in planar chunks)
    onProgress('encoding audio', 0.05);
    const audio48 = await to48kStereo(audio);
    const ch0 = audio48.getChannelData(0);
    const ch1 = audio48.numberOfChannels > 1 ? audio48.getChannelData(1) : ch0;
    const chunkFrames = 8192;
    for (let offset = 0; offset < audio48.length; offset += chunkFrames) {
      if (signal.aborted) throw abortError();
      const frames = Math.min(chunkFrames, audio48.length - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(ch0.subarray(offset, offset + frames), 0);
      planar.set(ch1.subarray(offset, offset + frames), frames);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / 48000) * 1e6),
        data: planar,
      });
      audioEncoder.encode(data);
      data.close();
      if (audioEncoder.encodeQueueSize > 12) await IDLE();
    }
    await audioEncoder.flush();

    // 2. video, streamed frame by frame
    const keyEvery = fps * 2;
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) throw abortError();
      const t = i / fps;
      drawFrame(ctx as CanvasRenderingContext2D, w, h, style, activeText(lines, t), t);
      const frame = new VideoFrame(canvas as CanvasImageSource, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round((1 / fps) * 1e6),
      });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();

      if (videoEncoder.encodeQueueSize > 6) await IDLE();
      if (i % 10 === 0) {
        onProgress('render frame', 0.1 + (i / totalFrames) * 0.85);
        await IDLE();
      }
    }

    onProgress('menutup file', 0.97);
    await videoEncoder.flush();
    muxer.finalize();
    onProgress('selesai', 1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      /* already closed */
    }
    try {
      if (audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      /* already closed */
    }
    if ('width' in canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Fallback for browsers without an MP4 encoder path: WebM via MediaRecorder.
 * This captures in real time, so exporting takes as long as the song.
 */
export async function exportWebm(opts: ExportOptions): Promise<Blob> {
  const { audio, lines, style, signal, onProgress } = opts;
  const { w, h } = ASPECT_SIZES[style.aspect];
  const fps = style.fps;

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  if (!mime) throw new Error('Browser ini tidak mendukung MediaRecorder WebM.');

  const { canvas, ctx } = makeCanvas(w, h) as {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D;
  };
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('WebM capture butuh canvas DOM.');
  }

  const stream = canvas.captureStream(fps);
  const ac = new AudioContext({ sampleRate: audio.sampleRate });
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = audio;
  src.connect(dest);
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  let raf = 0;
  let stopped = false;
  const startedAt = performance.now();

  const paint = () => {
    const t = (performance.now() - startedAt) / 1000;
    drawFrame(ctx, w, h, style, activeText(lines, t), t);
    onProgress('merekam (realtime)', Math.min(0.99, t / audio.duration));
    if (t < audio.duration && !stopped && !signal.aborted) {
      raf = requestAnimationFrame(paint);
    }
  };

  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        stream.getTracks().forEach((tr) => tr.stop());
      } catch {
        /* noop */
      }
      void ac.close();
    };

    recorder.onstop = () => {
      cleanup();
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      onProgress('selesai', 1);
      resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('MediaRecorder gagal merekam.'));
    };
    signal.addEventListener('abort', () => {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    });

    recorder.start(200);
    src.start();
    raf = requestAnimationFrame(paint);
    src.onended = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    };
  });
}
