import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExportPanel from './components/ExportPanel';
import Preview from './components/Preview';
import TimingEditor from './components/TimingEditor';
import Waveform from './components/Waveform';
import * as db from './lib/db';
import {
  computePeaks,
  decodeAudioFile,
  fmtBytes,
  fmtTime,
  metaFrom,
  mono16k,
  resumeAudio,
  type Peaks,
} from './lib/audio';
import { MODELS, alignLyricsToDetected, runAlignment, type AlignRun, type DetectedWord } from './lib/sync';
import {
  ASPECT_SIZES,
  DEFAULT_STYLE,
  PRESETS,
  newLine,
  newProject,
  type AspectRatio,
  type LyricLine,
  type ProjectState,
  type StyleConfig,
  type ProjectRecord,
} from './lib/types';

interface SyncInfo {
  words: number;
  matched: number;
  total: number;
  confidence: number;
}

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => newProject());
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const [model, setModel] = useState(MODELS[1].id);
  const [language, setLanguage] = useState('id');
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [tapMode, setTapMode] = useState(false);
  const [tapIndex, setTapIndex] = useState(0);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const alignRef = useRef<AlignRun | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const el = useCallback((): HTMLAudioElement => {
    if (!audioElRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      audioElRef.current = a;
    }
    return audioElRef.current;
  }, []);

  const refreshProjects = useCallback(() => {
    void db.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    refreshProjects();
    return () => {
      const a = audioElRef.current;
      if (a) {
        a.pause();
        a.src = '';
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      alignRef.current?.cancel();
    };
  }, [refreshProjects]);

  /* ---------------- playback ---------------- */

  useEffect(() => {
    const a = el();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onPause);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onPause);
    };
  }, [el]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = el();
      setPlayhead(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, el]);

  const togglePlay = useCallback(async () => {
    const a = el();
    if (!a.src) return;
    await resumeAudio().catch(() => undefined);
    if (a.paused) {
      await a.play().catch(() => setError('Audio tidak bisa diputar. Coba klik sekali lagi.'));
    } else {
      a.pause();
    }
  }, [el]);

  const seek = useCallback(
    (t: number) => {
      const a = el();
      if (!Number.isFinite(t)) return;
      const clamped = Math.max(0, Math.min(a.duration || 0, t));
      a.currentTime = clamped;
      setPlayhead(clamped);
    },
    [el],
  );

  /* ---------------- audio import ---------------- */

  const applyAudio = useCallback(
    (buffer: AudioBuffer, file: File) => {
      blobRef.current = file;
      const url = URL.createObjectURL(file);
      const a = el();
      a.src = url;
      a.currentTime = 0;
      if (audioUrlRef.current && audioUrlRef.current !== url) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      setAudio(buffer);
      setPeaks(null);
      setPlayhead(0);
      setNeedsAudio(false);
      setSyncInfo(null);
      setSyncStatus('');
      void computePeaks(buffer, 1400)
        .then(setPeaks)
        .catch(() => setPeaks(null));
      setProject((p) => ({
        ...p,
        audioMeta: metaFrom(file, buffer),
        name: p.name === 'untitled' ? file.name.replace(/\.[^.]+$/, '') : p.name,
      }));
    },
    [el],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);
      setBusy('mendekode audio di browser');
      try {
        const buffer = await decodeAudioFile(file);
        applyAudio(buffer, file);
        setNotice(`Audio dimuat: ${file.name} · ${fmtTime(buffer.duration)}`);
      } catch (err) {
        setError(
          `Gagal mendekode audio: ${(err as Error).message}. Coba format lain (mp3, wav, m4a, ogg).`,
        );
      } finally {
        setBusy(null);
      }
    },
    [applyAudio],
  );

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    // do not persist a completely empty scratch project
    if (!project.audioMeta && project.lines.length === 0 && project.name === 'untitled') return;
    const t = setTimeout(() => {
      const blob = blobRef.current ?? undefined;
      blobRef.current = null;
      void db
        .saveProject(project, blob)
        .then(refreshProjects)
        .catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
  }, [project, refreshProjects]);

  const openProject = useCallback(
    async (id: string) => {
      setError(null);
      setNotice(null);
      try {
        const rec = await db.getProject(id);
        if (!rec) return;
        const a = el();
        a.pause();
        setProject({
          id: rec.id,
          name: rec.name,
          style: rec.style ?? { ...DEFAULT_STYLE },
          lines: rec.lines ?? [],
          audioMeta: rec.audioMeta ?? null,
          updatedAt: rec.updatedAt,
        });
        setSyncInfo(null);
        setSyncStatus('');
        setPlayhead(0);
        setPeaks(null);
        setTapIndex(0);
        if (rec.audio) {
          setBusy('memuat audio dari project');
          try {
            const file = new File([rec.audio], rec.audioMeta?.name ?? 'audio', {
              type: rec.audio.type,
            });
            const buffer = await decodeAudioFile(file);
            blobRef.current = null;
            const url = URL.createObjectURL(file);
            a.src = url;
            a.currentTime = 0;
            if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = url;
            setAudio(buffer);
            setNeedsAudio(false);
            void computePeaks(buffer, 1400).then(setPeaks).catch(() => setPeaks(null));
          } finally {
            setBusy(null);
          }
        } else {
          setAudio(null);
          a.removeAttribute('src');
          setNeedsAudio(true);
          if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = null;
          }
        }
      } catch (err) {
        setError(`Gagal membuka project: ${(err as Error).message}`);
      }
    },
    [el],
  );

  const removeProject = useCallback(
    async (id: string) => {
      await db.deleteProject(id);
      refreshProjects();
      if (id === project.id) {
        const fresh = newProject();
        setProject(fresh);
        setAudio(null);
        setPeaks(null);
        setNeedsAudio(false);
        setSyncInfo(null);
        el().removeAttribute('src');
      }
    },
    [project.id, refreshProjects, el],
  );

  /* ---------------- lyrics ---------------- */

  const lyricsText = useMemo(() => project.lines.map((l) => l.text).join('\n'), [project.lines]);

  const onLyricsChange = useCallback((text: string) => {
    const rows = text.split('\n');
    setProject((p) => {
      const lines: LyricLine[] = rows.map((row, i) => {
        const existing = p.lines[i];
        if (existing) return { ...existing, text: row };
        const step = 3;
        return newLine(row, i * step, i * step + step * 0.9);
      });
      return { ...p, lines };
    });
    setSyncInfo(null);
  }, []);

  const distributeEvenly = useCallback(() => {
    const duration = audio?.duration ?? project.audioMeta?.duration ?? 0;
    if (!duration || !project.lines.length) return;
    setProject((p) => {
      const step = duration / p.lines.length;
      const lines = p.lines.map((l, i) => ({
        ...l,
        start: Number((i * step).toFixed(2)),
        end: Number(((i + 1) * step - 0.06).toFixed(2)),
      }));
      return { ...p, lines };
    });
    setNotice('Timestamp dibagi rata sebagai titik awal. Ini bukan auto-sync, koreksi manual tetap perlu.');
  }, [audio, project.audioMeta, project.lines.length]);

  /* ---------------- auto sync ---------------- */

  const startAutoSync = useCallback(async () => {
    if (!audio) {
      setSyncError('Import audio dulu sebelum menjalankan auto-sync.');
      return;
    }
    if (!project.lines.length) {
      setSyncError('Tempel lirik dulu. Auto-sync mencocokkan kata yang terdeteksi ke teks lirikmu.');
      return;
    }
    setSyncError(null);
    setSyncInfo(null);
    setSyncRunning(true);
    setSyncProgress(null);
    setSyncStatus('menyiapkan audio 16 kHz mono');
    el().pause();

    const mono = mono16k(audio);
    const run = runAlignment(mono, model, language, (p) => {
      if (p.phase === 'status') setSyncStatus(p.message);
      else if (p.phase === 'download') {
        setSyncStatus(`mengunduh ${p.message}`);
        setSyncProgress(p.value ?? null);
      } else {
        setSyncStatus(p.message);
      }
    });
    alignRef.current = run;

    try {
      const words: DetectedWord[] = await run.promise;
      const summary = alignLyricsToDetected(project.lines, words);
      setProject((p) => ({ ...p, lines: summary.lines }));
      setSyncInfo({
        words: words.length,
        matched: summary.matchedWords,
        total: summary.totalWords,
        confidence: summary.confidence,
      });
      setSyncStatus('selesai');
    } catch (err) {
      setSyncError((err as Error).message);
      setSyncStatus('');
    } finally {
      alignRef.current = null;
      setSyncRunning(false);
      setSyncProgress(null);
    }
  }, [audio, project.lines, model, language, el]);

  const cancelAutoSync = useCallback(() => {
    alignRef.current?.cancel();
    alignRef.current = null;
    setSyncRunning(false);
    setSyncProgress(null);
    setSyncStatus('dibatalkan');
  }, []);

  /* ---------------- tap sync ---------------- */

  const stampTap = useCallback(() => {
    const a = el();
    const t = Number.isFinite(a.currentTime) ? a.currentTime : playhead;
    setProject((p) => {
      const lines = p.lines.map((l) => ({ ...l }));
      const i = tapIndex;
      if (i >= lines.length) return p;
      lines[i].start = Number(t.toFixed(2));
      lines[i].end = Number(Math.max(t + 0.4, lines[i].end).toFixed(2));
      if (i > 0) {
        lines[i - 1].end = Number(Math.max(lines[i - 1].start + 0.15, t - 0.02).toFixed(2));
      }
      return { ...p, lines };
    });
    setTapIndex((i) => Math.min(i + 1, project.lines.length));
  }, [el, playhead, tapIndex, project.lines.length]);

  useEffect(() => {
    if (!tapMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (el().paused) void togglePlay();
        else stampTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tapMode, stampTap, togglePlay, el]);

  /* ---------------- style helpers ---------------- */

  const patchStyle = useCallback((patch: Partial<StyleConfig>) => {
    setProject((p) => ({ ...p, style: { ...p.style, ...patch } }));
  }, []);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setProject((p) => ({ ...p, style: { ...p.style, ...preset, preset: key } }));
  }, []);

  const activeIndex = useMemo(
    () => project.lines.findIndex((l) => playhead >= l.start && playhead < l.end),
    [project.lines, playhead],
  );

  const duration = audio?.duration ?? project.audioMeta?.duration ?? 0;
  const style = project.style;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <div>
            <h1>bratgen</h1>
            <p className="tagline">
              studio video lirik gaya brat · audio diproses di browser, tidak diunggah
            </p>
          </div>
        </div>
        <div className="row">
          <input
            type="text"
            value={project.name}
            onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
            style={{ width: 180 }}
            aria-label="nama project"
          />
          <button className="primary" onClick={() => void togglePlay()} disabled={!audio}>
            {playing ? '❚❚ pause' : '▶ play'}
          </button>
          <span className="badge mono">
            {fmtTime(playhead)} / {fmtTime(duration)}
          </span>
        </div>
      </header>

      {busy && <div className="alert">{busy}…</div>}
      {error && <div className="alert err">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="layout">
        <div className="stack">
          <section className="panel">
            <h2>1 · audio</h2>
            <div
              className={`drop${dragActive ? ' active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
            >
              {audio && project.audioMeta ? (
                <>
                  <strong>{project.audioMeta.name}</strong>
                  <div className="small" style={{ marginTop: 4 }}>
                    {fmtTime(project.audioMeta.duration)} · {project.audioMeta.channels} ch ·{' '}
                    {project.audioMeta.sampleRate} Hz · {fmtBytes(project.audioMeta.size)}
                  </div>
                </>
              ) : (
                <>
                  <strong>tarik file lagu ke sini</strong>
                  <div className="small" style={{ marginTop: 4 }}>
                    atau klik untuk memilih mp3 / wav / m4a / ogg
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            {needsAudio && (
              <div className="alert warn">
                Project ini tersimpan tanpa file audio (browser tidak menyimpan blob yang hilang).
                Pilih ulang file lagunya, konfigurasi desain dan timing tetap utuh.
              </div>
            )}
            <Waveform peaks={peaks} duration={duration} playhead={playhead} lines={project.lines} onSeek={seek} />
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={() => void togglePlay()} disabled={!audio}>
                {playing ? 'pause' : 'play'}
              </button>
              <button onClick={() => seek(playhead - 2)} disabled={!audio}>
                −2s
              </button>
              <button onClick={() => seek(playhead + 2)} disabled={!audio}>
                +2s
              </button>
              <button
                className="ghost"
                onClick={() => {
                  seek(0);
                  setTapIndex(0);
                }}
                disabled={!audio}
              >
                ke awal
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>2 · lirik</h2>
            <textarea
              value={lyricsText}
              onChange={(e) => onLyricsChange(e.target.value)}
              placeholder={'satu baris = satu layar\n\ntulis liriknya di sini'}
              spellCheck={false}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small">{project.lines.length} baris</span>
              <div className="grow" />
              <button onClick={distributeEvenly} disabled={!project.lines.length || !duration}>
                bagi rata (kasar)
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>3 · auto-sync</h2>
            <div className="grid2">
              <label className="field">
                model
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={syncRunning}>
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.size}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                bahasa audio
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={syncRunning}
                >
                  <option value="id">Indonesia</option>
                  <option value="en">Inggris</option>
                  <option value="ms">Melayu</option>
                  <option value="ja">Jepang</option>
                  <option value="ko">Korea</option>
                  <option value="zh">Mandarin</option>
                  <option value="es">Spanyol</option>
                  <option value="ar">Arab</option>
                </select>
              </label>
            </div>
            <p className="hint">
              {MODELS.find((m) => m.id === model)?.note}. Model diunduh dari Hugging Face saat
              pertama dipakai, lalu di-cache browser. Audio tetap di perangkat ini.
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => void startAutoSync()} disabled={syncRunning || !audio}>
                {syncRunning ? 'berjalan…' : 'jalankan auto-sync'}
              </button>
              {syncRunning && (
                <button className="ghost danger" onClick={cancelAutoSync}>
                  batalkan
                </button>
              )}
            </div>
            {(syncRunning || syncStatus) && (
              <div style={{ marginTop: 10 }}>
                {syncProgress !== null && (
                  <div className="progress">
                    <span style={{ width: `${syncProgress}%` }} />
                  </div>
                )}
                <p className="small" style={{ marginTop: 6 }}>
                  {syncStatus}
                  {syncProgress !== null ? ` · ${syncProgress}%` : ''}
                </p>
              </div>
            )}
            {syncInfo && (
              <div className={`alert ${syncInfo.confidence >= 0.5 ? 'ok' : 'warn'}`}>
                {syncInfo.words} kata terdeteksi Whisper, {syncInfo.matched} dari {syncInfo.total} kata
                lirik berhasil dicocokkan ({Math.round(syncInfo.confidence * 100)}%). Baris yang tidak
                cocok diinterpolasi di antara tetangganya. Periksa dan koreksi hasilnya di panel timing.
              </div>
            )}
            {syncError && <div className="alert err">{syncError}</div>}
            <p className="hint">
              Akurasi pada vokal bernyanyi lebih rendah daripada ucapan biasa, terutama kalau
              instrumennya ramai. Selalu siapkan koreksi manual.
            </p>
          </section>

          <section className="panel">
            <h2>4 · timing</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button
                className={tapMode ? 'primary' : ''}
                onClick={() => {
                  setTapMode((v) => !v);
                  setTapIndex(0);
                }}
              >
                {tapMode ? 'tap sync aktif' : 'tap sync'}
              </button>
              {tapMode && (
                <span className="small">
                  baris {Math.min(tapIndex + 1, project.lines.length)} / {project.lines.length}
                  {tapIndex >= project.lines.length ? ' · selesai' : ' · spasi untuk stamp'}
                </span>
              )}
            </div>
            {tapMode && (
              <div className="tap-zone" onClick={stampTap}>
                <div className="small">tekan untuk stamp (spasi / enter juga bisa)</div>
                <div className="tap-word">
                  {project.lines[tapIndex]?.text || 'semua baris sudah di-stamp'}
                </div>
                <div className="small">
                  playhead {fmtTime(playhead)} · {playing ? 'sedang diputar' : 'audio berhenti'}
                </div>
              </div>
            )}
            <TimingEditor
              lines={project.lines}
              playhead={playhead}
              activeIndex={activeIndex}
              onChange={(lines) => setProject((p) => ({ ...p, lines }))}
              onSeek={(t) => {
                seek(t);
                if (!playing) void togglePlay();
              }}
            />
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>preview</h2>
            <Preview style={style} lines={project.lines} time={playhead} />
            <p className="hint">
              Render di canvas memakai jalur yang sama dengan exporter, jadi tampilan preview sama
              dengan video hasilnya.
            </p>
          </section>

          <section className="panel">
            <h2>gaya</h2>
            <div className="chips" style={{ marginBottom: 10 }}>
              {Object.keys(PRESETS).map((k) => (
                <button
                  key={k}
                  className={`chip${style.preset === k ? ' active' : ''}`}
                  onClick={() => applyPreset(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="grid2">
              <label className="field">
                background
                <input
                  type="color"
                  value={style.bg}
                  onChange={(e) => patchStyle({ bg: e.target.value, preset: 'custom' })}
                />
              </label>
              <label className="field">
                teks
                <input
                  type="color"
                  value={style.fg}
                  onChange={(e) => patchStyle({ fg: e.target.value, preset: 'custom' })}
                />
              </label>
            </div>
            <label className="field" style={{ marginTop: 10 }}>
              ukuran teks · {Math.round(style.sizeRatio * 100)}%
              <input
                type="range"
                min="0.06"
                max="0.34"
                step="0.01"
                value={style.sizeRatio}
                onChange={(e) => patchStyle({ sizeRatio: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              blur · {style.blur.toFixed(1)}
              <input
                type="range"
                min="0"
                max="8"
                step="0.2"
                value={style.blur}
                onChange={(e) => patchStyle({ blur: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              goyang · {Math.round(style.wobble * 100)}%
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={style.wobble}
                onChange={(e) => patchStyle({ wobble: Number(e.target.value) })}
              />
            </label>
            <div className="grid2" style={{ marginTop: 10 }}>
              <label className="field">
                rasio
                <select
                  value={style.aspect}
                  onChange={(e) => patchStyle({ aspect: e.target.value as AspectRatio })}
                >
                  {(Object.keys(ASPECT_SIZES) as AspectRatio[]).map((k) => (
                    <option key={k} value={k}>
                      {ASPECT_SIZES[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                fps
                <select value={style.fps} onChange={(e) => patchStyle({ fps: Number(e.target.value) })}>
                  <option value={24}>24</option>
                  <option value={25}>25</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </label>
            </div>
            <label className="row" style={{ marginTop: 10, gap: 8 }}>
              <input
                type="checkbox"
                checked={style.uppercase}
                onChange={(e) => patchStyle({ uppercase: e.target.checked })}
                style={{ width: 18 }}
              />
              <span className="small">HURUF BESAR</span>
            </label>
          </section>

          <section className="panel">
            <h2>export</h2>
            <ExportPanel audio={audio} lines={project.lines} style={style} fileName={project.name} />
          </section>

          <section className="panel">
            <h2>project tersimpan</h2>
            <div className="row" style={{ marginBottom: 8 }}>
              <button
                onClick={() => {
                  const fresh = newProject();
                  setProject(fresh);
                  setAudio(null);
                  setPeaks(null);
                  setNeedsAudio(false);
                  setSyncInfo(null);
                  setPlayhead(0);
                  el().removeAttribute('src');
                }}
              >
                project baru
              </button>
              <span className="small">{projects.length} tersimpan di IndexedDB</span>
            </div>
            <div className="lines-list">
              {projects.map((p) => (
                <div key={p.id} className={`line-item${p.id === project.id ? ' current' : ''}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="line-text">{p.name}</div>
                    <div className="small">
                      {p.lines?.length ?? 0} baris · {p.audioMeta ? 'audio tersimpan' : 'tanpa audio'} ·{' '}
                      {new Date(p.updatedAt).toLocaleString('id-ID')}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="mini" onClick={() => void openProject(p.id)}>
                      buka
                    </button>
                    <button className="mini ghost danger" onClick={() => void removeProject(p.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {!projects.length && <p className="small">Belum ada project tersimpan.</p>}
            </div>
          </section>
        </div>
      </div>

      <footer className="footer">
        Bratgen memproses audio sepenuhnya di browser: decode, waveform, alignment, render frame, dan
        muxing video. Tidak ada API route, tidak ada database, tidak ada secret di frontend. Model ASR
        diunduh dari Hugging Face hanya saat auto-sync dijalankan.
      </footer>
    </div>
  );
}
