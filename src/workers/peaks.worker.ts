/// <reference lib="webworker" />
import { peaksInline } from '../lib/audio';

self.onmessage = (e: MessageEvent<{ samples: Float32Array; buckets: number }>) => {
  const { samples, buckets } = e.data;
  const { min, max } = peaksInline(samples, buckets);
  (self as unknown as Worker).postMessage({ min, max }, [min.buffer, max.buffer]);
};
