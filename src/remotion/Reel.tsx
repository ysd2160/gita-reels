import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { Background } from './Background';
import { devanagari, poppins } from './fonts';
import { TEMPLATES, Palette } from './templates';

export type Word = { text: string; emph: boolean; start: number; end: number };
export type Line = { start: number; end: number; words: Word[] };
export type AudioSeg = { url: string; start: number; duration: number; rate: number };
// zoom / x / y = the editor's manual framing of the picture (zoom 1 = normal, x / y in pixels of the video); motion 'none' = no camera move
export type Scene = { type: 'video' | 'image' | 'none'; url: string; start: number; end: number; trim: number; motion: 'in' | 'out' | 'left' | 'right' | 'up' | 'none'; zoom?: number; x?: number; y?: number };
export type Shlok = { sanskrit: string; reference: string; from: number; to: number };
export type Chapter = { at: number; title: string };
export type StyleProps = {
  artStyle?: string;
  templateId: string;
  captionStyle: 'pop' | 'box' | 'glow';
  shlokStyle: 'card' | 'minimal' | 'band';
  hookStyle: 'big' | 'band';
  transition: 'fade' | 'zoom' | 'slide' | 'flash';
  /** video format (shorts only): classic = big hook, captions, CTA | headline = title stays on top | kinetic = one huge word at a time | frame = picture in a rounded window | cinema = letterbox + subtitles */
  variant?: Variant;
};
export type Variant = 'classic' | 'headline' | 'kinetic' | 'frame' | 'cinema';
export const VARIANTS_LIST: Variant[] = ['classic', 'headline', 'kinetic', 'frame', 'cinema'];
/** y values are the CENTRE of the element as a fraction of the canvas height (0..1) */
export type Layout = {
  hookY: number; capY: number; shlokY: number; ctaY: number;
  hookSize: number; capSize: number; // multipliers (1 = default)
  showHook: boolean; showCaptions: boolean; showShlok: boolean; showCta: boolean; showProgress: boolean; showGrain: boolean; showDust: boolean;
  voiceVolume: number;
};
export type ReelProps = {
  format: 'short' | 'long';
  durationSec: number;
  style: StyleProps;
  accent: string; // '' = template default
  textColor: string;
  layout: Layout;
  hook: string;
  lines: Line[];
  audio: AudioSeg[];
  scenes: Scene[];
  shloks: Shlok[];
  chapters: Chapter[];
  cta: string;
  musicUrl: string | null;
  musicVolume: number;
  musicOn: boolean;
  channel: string;
  seed: number;
};

export const DEFAULT_LAYOUT: Record<'short' | 'long', Layout> = {
  short: { hookY: 0.2, capY: 0.6, shlokY: 0.42, ctaY: 0.82, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
  long: { hookY: 0.45, capY: 0.82, shlokY: 0.4, ctaY: 0.5, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
};

/** per-format placement (shorts). Applied on top of DEFAULT_LAYOUT.short when a video is made or the format is changed in the editor. */
export const VARIANT_LAYOUT: Record<Variant, Partial<Layout>> = {
  classic: {},
  headline: { hookY: 0.17, hookSize: 0.6, capY: 0.62, ctaY: 0.86 },
  kinetic: { hookY: 0.2, capY: 0.55, capSize: 1.5, ctaY: 0.84 },
  frame: { hookY: 0.115, hookSize: 0.6, capY: 0.79, capSize: 0.9, shlokY: 0.44, ctaY: 0.91 },
  cinema: { hookY: 0.08, hookSize: 0.5, capY: 0.915, capSize: 0.62, shlokY: 0.45, ctaY: 0.78, showProgress: false },
};

const OVERLAP = 7; // frames of cross-transition between scenes

const useDims = () => {
  const { width, height, fps } = useVideoConfig();
  const isLong = width > height;
  return { w: width, h: height, fps, isLong, u: Math.min(width, height) / 1080, fs: isLong ? 0.62 : 1 };
};

const withPalette = (base: Palette, accent: string, text: string): Palette => ({ ...base, accent: accent || base.accent, text: text || base.text });

// ------------------------------------------------------------------ scenes (moving visuals)
const SceneLayer: React.FC<{ scene: Scene; transition: StyleProps['transition']; isFirst: boolean; total: number; idx: number }> = ({ scene, transition, isFirst, total, idx }) => {
  const frame = useCurrentFrame();
  const { fps, isLong } = useDims();
  const t = Math.min(1, frame / Math.max(1, total));
  const e = Easing.inOut(Easing.cubic)(t); // camera eases in and out, like a real move
  const p = isFirst ? 1 : interpolate(frame, [0, OVERLAP], [0, 1], { extrapolateRight: 'clamp' });
  const ease = 1 - Math.pow(1 - p, 3);
  const isImg = scene.type === 'image';

  // A still image gets a real "camera": a base zoom that hides every edge, a strong push / pull, a pan, a tiny handheld wobble, a punch on the cut and light breathing.
  const dir = scene.motion;
  const still = dir === 'none'; // no push / pan / wobble: the picture stays exactly where the editor put it
  const base = isImg ? (isLong ? 1.06 : 1.1) : 1.04;
  const kb = still ? 0 : isImg ? (isLong ? 0.1 : 0.17) : 0.07;
  const pan = still ? 0 : isImg ? (isLong ? 20 : 34) : 18;
  let scale = base + (dir === 'out' ? kb * (1 - e) : kb * e);
  let tx = 0;
  let ty = 0;
  if (dir === 'left') tx = (1 - 2 * e) * pan;
  if (dir === 'right') tx = (2 * e - 1) * pan;
  if (dir === 'up') ty = (1 - 2 * e) * pan;
  if (isImg && !still) {
    const ph = idx * 1.7;
    tx += Math.sin(frame / 7 + ph) * 2.2;
    ty += Math.cos(frame / 8.3 + ph) * 2.2;
  }
  const rot = isImg && !still ? Math.sin(frame / 23 + idx) * 0.35 : 0;
  const punch = isFirst ? 0 : interpolate(frame, [0, 8], [0.06, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  scale += punch;
  if (transition === 'zoom') scale *= 1 + (1 - ease) * 0.22;
  if (transition === 'slide') tx += (1 - ease) * 110;
  scale *= scene.zoom && scene.zoom > 0 ? scene.zoom : 1; // manual framing from the editor
  tx += scene.x || 0;
  ty += scene.y || 0;

  const style: React.CSSProperties = {
    width: '100%', height: '100%', objectFit: 'cover',
    transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`,
    ...(isImg ? { filter: `brightness(${(1 + 0.035 * Math.sin(frame / 11 + idx)).toFixed(3)})` } : {}),
  };
  const flash = transition === 'flash' && !isFirst ? interpolate(frame, [0, 4], [0.75, 0], { extrapolateRight: 'clamp' }) : 0;

  return (
    <AbsoluteFill style={{ opacity: transition === 'flash' ? 1 : ease, overflow: 'hidden' }}>
      {scene.type === 'video' ? (
        <OffthreadVideo src={scene.url} muted trimBefore={Math.round(scene.trim * fps)} style={style} />
      ) : scene.type === 'image' ? (
        <Img src={scene.url} style={style} />
      ) : null}
      {flash > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};

const Scenes: React.FC<{ scenes: Scene[]; transition: StyleProps['transition'] }> = ({ scenes, transition }) => {
  const { fps } = useDims();
  return (
    <>
      {scenes.map((sc, i) => {
        if (sc.type === 'none' || !sc.url) return null;
        const from = Math.max(0, Math.round(sc.start * fps) - (i === 0 ? 0 : OVERLAP));
        const len = Math.round((sc.end - sc.start) * fps) + (i === 0 ? 0 : OVERLAP) + 2;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(2, len)}>
            <SceneLayer scene={sc} transition={transition} isFirst={i === 0} total={len} idx={i} />
          </Sequence>
        );
      })}
    </>
  );
};

// ------------------------------------------------------------------ overlays
const Grade: React.FC<{ palette: Palette }> = ({ palette }) => (
  <>
    <AbsoluteFill style={{ background: 'rgba(0,0,0,0.22)' }} />
    <AbsoluteFill style={{ background: `${palette.bg[1]}`, opacity: 0.35, mixBlendMode: 'soft-light' }} />
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.7) 100%)' }} />
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)' }} />
  </>
);

const Dust: React.FC<{ palette: Palette; seed: number }> = ({ palette, seed }) => {
  const frame = useCurrentFrame();
  const { w: width, h: height, fps } = useDims();
  const t = frame / fps;
  const parts = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    x: random(`dx-${seed}-${i}`) * width, y: random(`dy-${seed}-${i}`) * height,
    r: 2 + random(`dr-${seed}-${i}`) * 4, s: 20 + random(`ds-${seed}-${i}`) * 45, ph: random(`dp-${seed}-${i}`) * 50,
  })), [seed, width, height]);
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: 0.55 }}>
      {parts.map((p, i) => {
        const y = (((p.y - t * p.s) % height) + height) % height;
        const x = p.x + Math.sin(t + p.ph) * 22;
        return <circle key={i} cx={x} cy={y} r={p.r} fill={palette.accent} opacity={0.25 + 0.5 * Math.abs(Math.sin(t * 1.2 + p.ph))} />;
      })}
    </svg>
  );
};

const Progress: React.FC<{ palette: Palette; durationSec: number }> = ({ palette, durationSec }) => {
  const frame = useCurrentFrame();
  const { fps, isLong, w } = useDims();
  const pct = Math.min(1, frame / fps / durationSec) * 100;
  const style: React.CSSProperties = isLong
    ? { position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: 'rgba(255,255,255,0.15)' }
    : { position: 'absolute', top: 120, left: 60, right: 60, height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.18)' };
  void w;
  return (
    <div style={style}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: isLong ? 0 : 6, background: palette.accent }} />
    </div>
  );
};

const Grain: React.FC<{ seed: number }> = ({ seed }) => {
  const frame = useCurrentFrame();
  const url = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d')!;
    const d = ctx.createImageData(200, 200);
    for (let i = 0; i < d.data.length; i += 4) { const v = random(`g${seed}-${i}`) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    ctx.putImageData(d, 0, 0);
    return c.toDataURL();
  }, [seed]);
  return <AbsoluteFill style={{ backgroundImage: `url(${url})`, backgroundPosition: `${(frame * 37) % 200}px ${(frame * 91) % 200}px`, opacity: 0.07, mixBlendMode: 'overlay' }} />;
};

// positions a block by its centre line
const At: React.FC<{ y: number; children: React.ReactNode; pad?: number }> = ({ y, children, pad = 0 }) => {
  const { h } = useDims();
  return <div style={{ position: 'absolute', left: pad, right: pad, top: y * h, transform: 'translateY(-50%)' }}>{children}</div>;
};

// ------------------------------------------------------------------ captions
const Captions: React.FC<{ lines: Line[]; palette: Palette; mode: StyleProps['captionStyle']; y: number; size: number; shloks: Shlok[]; perWords?: number; noShift?: boolean }> = ({ lines, palette, mode, y, size, shloks, perWords, noShift }) => {
  const frame = useCurrentFrame();
  const { fps, isLong, u, fs } = useDims();
  const t = frame / fps;
  const per = perWords ?? (isLong ? 4 : 2);

  const chunks = useMemo(() => {
    const out: { words: Word[]; start: number; end: number }[] = [];
    for (const l of lines) {
      for (let i = 0; i < l.words.length; i += per) {
        const w = l.words.slice(i, i + per);
        const next = l.words[i + per];
        out.push({ words: w, start: w[0].start, end: next ? next.start : l.end });
      }
    }
    return out;
  }, [lines, per]);

  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;
  const pop = spring({ frame: frame - Math.round(chunk.start * fps), fps, durationInFrames: 8, config: { damping: 11, stiffness: 240 } });
  const overShlok = shloks.some((s) => t >= s.from - 0.1 && t <= s.to + 0.1);
  const yy = overShlok && !isLong && !noShift ? Math.max(y, 0.72) : y;
  const base = 94 * u * fs * size;

  return (
    <At y={yy} pad={isLong ? 160 : 50}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `${6 * u}px ${20 * u * fs}px`, transform: `scale(${0.86 + 0.14 * pop})`, opacity: Math.min(1, pop * 1.6) }}>
        {chunk.words.map((w, i) => {
          const active = t >= w.start && t < w.end;
          const st: React.CSSProperties = {
            fontFamily: poppins, fontWeight: 800, fontSize: w.emph ? base * 1.14 : base, textTransform: 'uppercase', letterSpacing: 1, lineHeight: 1.15,
            textShadow: '0 4px 18px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.95)', color: w.emph ? palette.accent : palette.text,
          };
          if (mode === 'pop' && active) st.color = palette.accent;
          if (mode === 'box' && active) Object.assign(st, { background: palette.accent, color: '#120a00', borderRadius: 18 * u * fs, padding: `0 ${20 * u * fs}px`, textShadow: 'none' });
          if (mode === 'glow') Object.assign(st, { opacity: active ? 1 : 0.72, transform: `scale(${active ? 1.1 : 1})`, textShadow: active ? `0 0 34px ${palette.accent}, 0 4px 16px rgba(0,0,0,0.95)` : st.textShadow });
          return <span key={i} style={st}>{w.text}</span>;
        })}
      </div>
    </At>
  );
};

// ------------------------------------------------------------------ hook / shlok / cta / chapters
const Hook: React.FC<{ text: string; palette: Palette; mode: StyleProps['hookStyle']; y: number; size: number; sticky?: boolean }> = ({ text, palette, mode, y, size, sticky }) => {
  const frame = useCurrentFrame();
  const { fps, u, fs, isLong } = useDims();
  const end = sticky ? Number.POSITIVE_INFINITY : (isLong ? 4 : 2.8) * fps;
  if (frame > end) return null;
  const opacity = sticky ? 1 : interpolate(frame, [end - 8, end], [1, 0], { extrapolateLeft: 'clamp' });
  const words = text.split(/\s+/).filter(Boolean);
  const box: React.CSSProperties = mode === 'band'
    ? { background: palette.accent, color: '#120a00', padding: `${34 * u * fs}px ${40 * u * fs}px`, borderRadius: 28 * u, boxShadow: `0 0 70px ${palette.glow}` }
    : { color: palette.text, textShadow: `0 0 44px ${palette.glow}, 0 5px 22px rgba(0,0,0,0.95)` };
  return (
    <At y={y} pad={isLong ? 200 : 60}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${26 * u * fs}px`, fontFamily: poppins, fontWeight: 800, fontSize: 104 * u * fs * size, lineHeight: 1.12, textAlign: 'center', opacity, ...box }}>
        {words.map((w, i) => {
          // the very first frame already shows the hook (no empty first second): word 1 is there at frame 0, the rest snap in within a few frames
          const p = spring({ frame: frame - i * 2, fps, durationInFrames: 9, config: { damping: 12, stiffness: 260 } });
          return <span key={i} style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 28}px) scale(${0.86 + 0.14 * p})`, opacity: i === 0 ? 1 : Math.min(1, p * 3) }}>{w}</span>;
        })}
      </div>
    </At>
  );
};

const ShlokCard: React.FC<{ shlok: Shlok; palette: Palette; mode: StyleProps['shlokStyle']; y: number }> = ({ shlok, palette, mode, y }) => {
  const frame = useCurrentFrame();
  const { fps, u, fs, isLong } = useDims();
  const from = shlok.from * fps;
  const to = shlok.to * fps;
  if (frame < from - 2 || frame > to + 12) return null;
  const opacity = interpolate(frame, [from, from + 10, to - 6, to + 10], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = 0.94 + 0.06 * spring({ frame: frame - from, fps, config: { damping: 13 } });
  const rows = shlok.sanskrit.split('\n');
  const span = Math.max(1, (to - from) * 0.8);
  const z = isLong ? 0.8 : 1;
  const box: React.CSSProperties =
    mode === 'card'
      ? { borderRadius: 36 * u, border: `3px solid ${palette.accent}`, background: 'rgba(0,0,0,0.58)', boxShadow: `0 0 70px ${palette.glow}`, padding: `${52 * u * z}px ${36 * u}px`, margin: isLong ? '0 auto' : 0, maxWidth: isLong ? 1300 : undefined }
      : mode === 'band'
        ? { background: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 15%, rgba(0,0,0,0.72) 85%, rgba(0,0,0,0) 100%)', padding: `${46 * u * z}px ${70 * u}px` }
        : { padding: `${20 * u}px` };
  void fs;
  return (
    <>
      <AbsoluteFill style={{ opacity: opacity * 0.5 }}>
        <div style={{ position: 'absolute', left: '50%', top: `${y * 100}%`, width: 2400, height: 2400, marginLeft: -1200, marginTop: -1200,
          background: `repeating-conic-gradient(from ${frame * 0.25}deg, ${palette.glow} 0deg 6deg, rgba(0,0,0,0) 6deg 24deg)`,
          maskImage: 'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 62%)', WebkitMaskImage: 'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 62%)' }} />
      </AbsoluteFill>
      <At y={y} pad={isLong ? 0 : 60}>
        <div style={{ textAlign: 'center', opacity, transform: `scale(${scale})`, ...box }}>
          {rows.map((r, i) => {
            const a = interpolate(frame, [from + (span * i) / rows.length, from + (span * i) / rows.length + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={i} style={{ fontFamily: devanagari, fontWeight: 700, fontSize: 58 * u * z, lineHeight: 1.6, color: palette.accent, opacity: a, transform: `translateY(${(1 - a) * 18}px)`, textShadow: `0 0 36px ${palette.glow}, 0 3px 14px rgba(0,0,0,0.9)` }}>{r}</div>
            );
          })}
          <div style={{ margin: '14px auto 0', width: 120 * u, height: 3, background: palette.accent, opacity: 0.7, borderRadius: 3 }} />
          <div style={{ marginTop: 18 * u, fontFamily: poppins, fontWeight: 600, fontSize: 34 * u * z, letterSpacing: 2, color: palette.text, opacity: 0.9 }}>{shlok.reference}</div>
        </div>
      </At>
    </>
  );
};

const Cta: React.FC<{ text: string; palette: Palette; durationSec: number; y: number }> = ({ text, palette, durationSec, y }) => {
  const frame = useCurrentFrame();
  const { fps, u, fs, isLong } = useDims();
  const from = Math.max(0, durationSec - (isLong ? 7 : 2.8)) * fps;
  if (frame < from) return null;
  const enter = spring({ frame: frame - from, fps, config: { damping: 12 } });
  const pulse = 1 + Math.sin((frame - from) / 6) * 0.03;
  return (
    <At y={y}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontFamily: poppins, fontWeight: 800, fontSize: 46 * u * (isLong ? 0.9 : fs), color: '#140b00', background: palette.accent, padding: `${20 * u}px ${50 * u}px`, borderRadius: 999, transform: `scale(${enter * pulse})`, boxShadow: `0 0 50px ${palette.glow}` }}>{text}</div>
      </div>
    </At>
  );
};

const ChapterCard: React.FC<{ chapter: Chapter; index: number; palette: Palette }> = ({ chapter, index, palette }) => {
  const frame = useCurrentFrame();
  const { fps, u } = useDims();
  const at = chapter.at * fps;
  if (frame < at || frame > at + 3.4 * fps) return null;
  const f = frame - at;
  const slide = spring({ frame: f, fps, config: { damping: 14 } });
  const opacity = interpolate(f, [0, 8, 3 * fps, 3.4 * fps], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 90 * u, top: 130 * u, opacity, transform: `translateX(${(1 - slide) * -80}px)`, display: 'flex', alignItems: 'center', gap: 22 * u }}>
      <div style={{ width: 8 * u, height: 84 * u, background: palette.accent, borderRadius: 4 }} />
      <div>
        <div style={{ fontFamily: poppins, fontWeight: 600, fontSize: 26 * u, letterSpacing: 6, color: palette.accent }}>PART {String(index + 1).padStart(2, '0')}</div>
        <div style={{ fontFamily: poppins, fontWeight: 800, fontSize: 52 * u, color: palette.text, textShadow: '0 4px 20px rgba(0,0,0,0.9)' }}>{chapter.title}</div>
      </div>
    </div>
  );
};

const GRADE: Record<string, string> = {
  'gold-cosmic': 'contrast(1.1) saturate(1.1) brightness(0.94)',
  'saffron-dawn': 'contrast(1.08) saturate(1.2) brightness(0.95) sepia(0.12)',
  'midnight-lotus': 'contrast(1.1) saturate(1.05) brightness(0.93) hue-rotate(-6deg)',
};

// ------------------------------------------------------------------ composition
export const Reel: React.FC<ReelProps> = (props) => {
  const { fps, isLong } = useDims();
  const L: Layout = { ...DEFAULT_LAYOUT[props.format === 'long' ? 'long' : 'short'], ...(props.layout || {}) };
  const palette = withPalette(TEMPLATES[props.style.templateId] ?? TEMPLATES['gold-cosmic'], props.accent, props.textColor);
  const shloks = props.shloks || [];
  const V: Variant = !isLong && props.style.variant && VARIANTS_LIST.includes(props.style.variant) ? props.style.variant : 'classic';
  const musicVolume = (f: number) => {
    const t = f / fps;
    let d = Infinity;
    for (const a of props.audio) d = Math.min(d, t < a.start ? a.start - t : t > a.start + a.duration ? t - a.start - a.duration : 0);
    const duck = 0.4 + 0.6 * Math.min(1, d / 0.7);
    return props.musicVolume * duck * Math.max(0, Math.min(1, t / 1.2, (props.durationSec - t) / 1.8));
  };
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Background palette={palette} seed={props.seed} />
      <AbsoluteFill style={{ filter: GRADE[props.style.templateId] ?? GRADE['gold-cosmic'] }}>
        {V === 'frame' ? (
          <div style={{ position: 'absolute', left: '5.5%', right: '5.5%', top: '22%', height: '44%', borderRadius: 46, overflow: 'hidden', border: `4px solid ${palette.accent}`, boxShadow: `0 0 80px ${palette.glow}` }}>
            <Scenes scenes={props.scenes} transition={props.style.transition} />
          </div>
        ) : V === 'cinema' ? (
          <div style={{ position: 'absolute', left: 0, right: 0, top: '15%', height: '70%', overflow: 'hidden' }}>
            <Scenes scenes={props.scenes} transition={props.style.transition} />
          </div>
        ) : (
          <Scenes scenes={props.scenes} transition={props.style.transition} />
        )}
      </AbsoluteFill>
      {V === 'cinema' ? (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '15%', background: '#000' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '15%', background: '#000' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '15%', height: 3, background: palette.accent, opacity: 0.8 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: '15%', height: 3, background: palette.accent, opacity: 0.8 }} />
        </>
      ) : null}
      <Grade palette={palette} />
      {L.showDust ? <Dust palette={palette} seed={props.seed} /> : null}
      {L.showGrain ? <Grain seed={props.seed} /> : null}
      {props.audio.map((a, i) => (
        <Sequence key={i} from={Math.round(a.start * fps)} durationInFrames={Math.ceil((a.duration + 0.25) * fps)}>
          <Audio src={a.url} playbackRate={a.rate} volume={L.voiceVolume} />
        </Sequence>
      ))}
      {props.musicUrl && props.musicOn !== false ? <Audio src={props.musicUrl} volume={musicVolume} loop /> : null}
      {L.showProgress ? <Progress palette={palette} durationSec={props.durationSec} /> : null}
      {props.channel && V !== 'cinema' && V !== 'frame' ? (
        <div style={{ position: 'absolute', top: isLong ? 40 : 150, left: 0, right: 0, textAlign: 'center', fontFamily: poppins, fontWeight: 600, fontSize: 30 * (isLong ? 0.7 : 1), letterSpacing: 4, color: palette.text, opacity: 0.6, textTransform: 'uppercase' }}>{props.channel}</div>
      ) : null}
      {(props.chapters || []).map((c, i) => <ChapterCard key={i} chapter={c} index={i} palette={palette} />)}
      {L.showHook ? <Hook text={props.hook} palette={palette} mode={V === 'headline' ? 'band' : props.style.hookStyle} y={L.hookY} size={L.hookSize} sticky={V === 'headline' || V === 'frame' || V === 'cinema'} /> : null}
      {L.showShlok ? shloks.map((s, i) => <ShlokCard key={i} shlok={s} palette={palette} mode={props.style.shlokStyle} y={L.shlokY} />) : null}
      {L.showCaptions ? <Captions lines={props.lines} palette={palette} mode={props.style.captionStyle} y={L.capY} size={L.capSize} shloks={shloks} perWords={V === 'kinetic' ? 1 : V === 'cinema' ? 4 : undefined} noShift={V === 'frame' || V === 'cinema'} /> : null}
      {L.showCta ? <Cta text={props.cta} palette={palette} durationSec={props.durationSec} y={L.ctaY} /> : null}
    </AbsoluteFill>
  );
};
