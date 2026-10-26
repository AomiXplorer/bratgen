import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtBytes, fmtTime } from '../lib/audio';
import { exportMp4, exportWebm, probeCapabilities, type Caps } from '../lib/export';
import type { LyricLine, StyleConfig } from '../lib/types';

export default function ExportPanel({
  audio,
  lines,
  style,
  fileName,
}: {
  audio: AudioBuffer | null;
  lines: LyricLine[];
  style: StyleConfig;
  fileName: string;
}) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [running, setRunning] = useState<null | 'mp4' | 'webm'>(null);
  const [phase, setPhase] = useState('');
  const [value, setValue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; size: number; type: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    probeCapabilities(style)
      .then((c) => {
        if (alive) setCaps(c);
      })
      .catch(() => {
        if (alive) setCaps(null);
      });
    return () => {
      alive = false;
    };
  }, [style]);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(
    async (kind: 'mp4' | 'webm') => {
      if (!audio) return;
      setError(null);
      if (result) {
        URL.revokeObjectURL(result.url);
        setResult(null);
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(kind);
      setValue(0);
      setPhase('menyiapkan');
      try {
        const opts = {
          audio,
          lines,
          style,
          signal: controller.signal,
          onProgress: (p: string, v: number) => {
            setPhase(p);
            setValue(v);
          },
        };
        const blob = kind === 'mp4' ? await exportMp4(opts) : await exportWebm(opts);
        const url = URL.createObjectURL(blob);
        setResult({ url, size: blob.size, type: blob.type });
        setValue(1);
        setPhase('selesai');
      } catch (err) {
        const e = err as Error;
        setError(e.name === 'AbortError' ? 'Export dibatalkan.' : e.message || 'Export gagal.');
        setPhase('');
      } finally {
        abortRef.current = null;
        setRunning(null);
      }
    },
    [audio, lines, style, result],
  );

  const dur = audio?.duration ?? 0;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {caps ? (
          <>
            <span className={`badge ${caps.mp4 ? 'ok' : 'warn'}`}>
              MP4 {caps.mp4 ? 'tersedia' : 'tidak tersedia'}
            </span>
            <span className="badge">{caps.videoCodec ?? 'no AVC'}</span>
            <span className={`badge ${caps.aac ? 'ok' : 'warn'}`}>AAC {caps.aac ? 'ok' : 'no'}</span>
            <span className={`badge ${caps.webm ? 'ok' : 'warn'}`}>WebM {caps.webm ? 'ok' : 'no'}</span>
          </>
        ) : (
          <span className="badge">memeriksa dukungan browser…</span>
        )}
      </div>

      <div className="row">
        <button
          className="primary"
          disabled={!audio || !caps?.mp4 || running !== null || !lines.length}
          onClick={() => void run('mp4')}
        >
          {running === 'mp4' ? 'Mengekspor…' : 'Export MP4'}
        </button>
        <button
          disabled={!audio || !caps?.webm || running !== null || !lines.length}
          onClick={() => void run('webm')}
        >
          {running === 'webm' ? 'Merekam…' : 'Export WebM'}
        </button>
        {running && (
          <button className="ghost danger" onClick={() => abortRef.current?.abort()}>
            Batal
          </button>
        )}
      </div>

      {(running || value > 0) && (
        <div style={{ marginTop: 10 }}>
          <div className="progress">
            <span style={{ width: `${Math.round(value * 100)}%` }} />
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            {phase} · {Math.round(value * 100)}% · durasi {fmtTime(dur)}
          </p>
        </div>
      )}

      {result && (
        <div className="alert ok">
          <a href={result.url} download={`${fileName || 'bratgen'}.${result.type.includes('mp4') ? 'mp4' : 'webm'}`}>
            Unduh hasil export
          </a>
          <div className="small" style={{ marginTop: 4 }}>
            {result.type} · {fmtBytes(result.size)} · dibuat di browser ini
          </div>
        </div>
      )}

      {error && <div className="alert err">{error}</div>}

      {caps && caps.notes.length > 0 && (
        <ul className="plain">
          {caps.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <p className="hint">
        MP4 dibuat dengan WebCodecs (H.264 + AAC) dan di-mux di browser. Tidak ada video yang
        dikirim ke server. WebM adalah jalur cadangan dan merekam secara realtime, jadi butuh waktu
        selama durasi lagu.
      </p>
    </div>
  );
}
