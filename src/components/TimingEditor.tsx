import { fmtTime } from '../lib/audio';
import type { LyricLine } from '../lib/types';

export default function TimingEditor({
  lines,
  playhead,
  activeIndex,
  onChange,
  onSeek,
}: {
  lines: LyricLine[];
  playhead: number;
  activeIndex: number;
  onChange: (lines: LyricLine[]) => void;
  onSeek: (t: number) => void;
}) {
  const update = (id: string, patch: Partial<LyricLine>) => {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const nudge = (line: LyricLine, delta: number) => {
    update(line.id, {
      start: Math.max(0, line.start + delta),
      end: Math.max(0.1, line.end + delta),
    });
  };

  if (!lines.length) {
    return <p className="small">Belum ada baris lirik. Tempel lirik dulu di panel Lirik.</p>;
  }

  return (
    <div className="lines-list">
      {lines.map((line, i) => (
        <div key={line.id} className={`line-item${i === activeIndex ? ' current' : ''}`}>
          <div style={{ minWidth: 0 }}>
            <div className="line-text">{line.text || <span className="small">(kosong)</span>}</div>
            <div className="line-times">
              <input
                type="number"
                step="0.01"
                min="0"
                value={Number(line.start.toFixed(2))}
                onChange={(e) => update(line.id, { start: Number(e.target.value) })}
                aria-label={`start baris ${i + 1}`}
              />
              <span className="small">→</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={Number(line.end.toFixed(2))}
                onChange={(e) => update(line.id, { end: Number(e.target.value) })}
                aria-label={`end baris ${i + 1}`}
              />
              <span className="small mono">{fmtTime(line.end - line.start)}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="mini ghost" title="putar dari baris ini" onClick={() => onSeek(line.start)}>
              ▶
            </button>
            <button className="mini" title="set start ke posisi playhead" onClick={() => update(line.id, { start: playhead })}>
              in
            </button>
            <button className="mini" title="set end ke posisi playhead" onClick={() => update(line.id, { end: playhead })}>
              out
            </button>
            <button className="mini ghost" title="geser 50 ms ke belakang" onClick={() => nudge(line, -0.05)}>
              −
            </button>
            <button className="mini ghost" title="geser 50 ms ke depan" onClick={() => nudge(line, 0.05)}>
              +
            </button>
            <button
              className="mini ghost danger"
              title="hapus baris"
              onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
