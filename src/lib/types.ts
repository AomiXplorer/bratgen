export type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5';

export interface StyleConfig {
  preset: string;
  bg: string;
  fg: string;
  fontFamily: string;
  fontWeight: number;
  /** font size as a fraction of the shorter canvas edge */
  sizeRatio: number;
  /** blur in px, scaled to canvas height */
  blur: number;
  uppercase: boolean;
  /** 0 = static, 1 = full wobble */
  wobble: number;
  aspect: AspectRatio;
  fps: number;
}

export interface LyricLine {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface AudioMeta {
  name: string;
  duration: number;
  size: number;
  type: string;
  channels: number;
  sampleRate: number;
}

export interface ProjectState {
  id: string;
  name: string;
  style: StyleConfig;
  lines: LyricLine[];
  audioMeta: AudioMeta | null;
  updatedAt: number;
}

export interface ProjectRecord extends ProjectState {
  audio?: Blob;
}

export const PRESETS: Record<string, Partial<StyleConfig>> = {
  brat: { bg: '#8ace00', fg: '#111111', blur: 2.2, uppercase: false },
  lime: { bg: '#c6ff00', fg: '#0b0b0b', blur: 1.2, uppercase: false },
  paper: { bg: '#f6f4ee', fg: '#141414', blur: 1.6, uppercase: false },
  night: { bg: '#0a0a0a', fg: '#f2f2f2', blur: 2.6, uppercase: false },
  ink: { bg: '#111111', fg: '#8ace00', blur: 0.8, uppercase: true },
};

export const DEFAULT_STYLE: StyleConfig = {
  preset: 'brat',
  bg: '#8ace00',
  fg: '#111111',
  fontFamily: 'Arial, Helvetica, "Helvetica Neue", sans-serif',
  fontWeight: 700,
  sizeRatio: 0.16,
  blur: 2.2,
  uppercase: false,
  wobble: 0.35,
  aspect: '9:16',
  fps: 30,
};

export const ASPECT_SIZES: Record<AspectRatio, { w: number; h: number; label: string }> = {
  '9:16': { w: 720, h: 1280, label: '9:16 · 720x1280' },
  '4:5': { w: 864, h: 1080, label: '4:5 · 864x1080' },
  '1:1': { w: 1080, h: 1080, label: '1:1 · 1080x1080' },
  '16:9': { w: 1280, h: 720, label: '16:9 · 1280x720' },
};

export function newProject(): ProjectState {
  return {
    id: 'p_' + Math.random().toString(36).slice(2, 10),
    name: 'untitled',
    style: { ...DEFAULT_STYLE },
    lines: [],
    audioMeta: null,
    updatedAt: Date.now(),
  };
}

export function newLine(text = '', start = 0, end = 2): LyricLine {
  return { id: 'l_' + Math.random().toString(36).slice(2, 10), text, start, end };
}
