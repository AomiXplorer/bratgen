/// <reference lib="webworker" />

/**
 * Alignment worker.
 * Runs Whisper (transformers.js) fully in the browser over WebAssembly and asks for
 * word level timestamps. The model is fetched from the Hugging Face CDN on demand and
 * cached by the browser afterwards. No audio ever leaves this machine: the samples are
 * transferred into this worker, never uploaded.
 */

const CDNS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1',
  'https://esm.sh/@huggingface/transformers@4.3.1',
];

type Progress = {
  type: 'status' | 'progress' | 'result' | 'error';
  message?: string;
  file?: string;
  loaded?: number;
  total?: number;
  chunks?: { text: string; timestamp: [number, number | null] }[];
};

const post = (m: Progress) => (self as unknown as Worker).postMessage(m);

interface LoaderResult {
  pipeline: unknown;
  env: { allowLocalModels: boolean; allowRemoteModels: boolean; backends?: Record<string, unknown> };
}

let cached: LoaderResult | null = null;

async function loadTransformers(): Promise<LoaderResult> {
  if (cached) return cached;
  let lastError: unknown = null;
  for (const url of CDNS) {
    try {
      const mod = (await import(/* @vite-ignore */ url)) as unknown as LoaderResult;
      if (typeof mod.pipeline !== 'function') throw new Error('Modul transformers tidak valid');
      mod.env.allowLocalModels = false;
      mod.env.allowRemoteModels = true;
      cached = mod;
      return mod;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    'Gagal memuat transformers.js dari CDN. Periksa koneksi internet. ' +
      String((lastError as Error)?.message ?? lastError ?? ''),
  );
}

self.onmessage = async (
  e: MessageEvent<{ audio: Float32Array; model: string; language: string }>,
) => {
  const { audio, model, language } = e.data;
  try {
    post({ type: 'status', message: 'memuat engine transformers.js' });
    const tf = await loadTransformers();

    post({ type: 'status', message: `mengunduh model ${model}` });
    const pipeFactory = tf.pipeline as (
      task: string,
      model: string,
      opts: Record<string, unknown>,
    ) => Promise<(input: Float32Array, opts: Record<string, unknown>) => Promise<unknown>>;

    const asr = await pipeFactory('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        post({
          type: 'progress',
          message: p.status,
          file: p.file,
          loaded: p.loaded,
          total: p.total,
        });
      },
    });

    post({ type: 'status', message: 'mendeteksi kata dan timestamp' });
    const out = (await asr(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      language,
    })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };

    const chunks = (out.chunks ?? []).map((c) => ({
      text: c.text,
      timestamp: [c.timestamp?.[0] ?? 0, c.timestamp?.[1] ?? null] as [number, number | null],
    }));

    if (!chunks.length) {
      post({ type: 'error', message: 'Model tidak mendeteksi kata apa pun pada audio ini.' });
      return;
    }
    post({ type: 'result', chunks });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
