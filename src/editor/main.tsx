import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { DEFAULT_LAYOUT, Layout, Reel, ReelProps, Scene, VARIANTS_LIST, VARIANT_LAYOUT, Variant } from '../remotion/Reel';
import { TEMPLATES } from '../remotion/templates';

const FPS = 30;
const LABW = 88; // width of the track-label column in the timeline (must match .lab in editor.html)
const id = new URLSearchParams(location.search).get('id') || '';
const api = (p: string, o: RequestInit = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then((r) => r.json());

// scenes carry the image prompt written at generation time (`prompt`) and the Google Flow prompt (`flow`, written by the editor)
type EScene = Scene & { prompt?: string; flow?: string };
type Project = Omit<ReelProps, 'scenes'> & { scenes: EScene[] };
type Tab = 'scene' | 'elements' | 'captions' | 'style' | 'audio';
const MOTIONS = ['in', 'out', 'left', 'right', 'up'] as const;
const CAMERA: Record<Scene['motion'], string> = { in: 'slow push-in', out: 'slow pull-back', left: 'smooth pan to the left', right: 'smooth pan to the right', up: 'slow tilt up' };
const TABS: { k: Tab; label: string }[] = [{ k: 'scene', label: 'SCENE' }, { k: 'elements', label: 'TEXT' }, { k: 'captions', label: 'CAPS' }, { k: 'style', label: 'STYLE' }, { k: 'audio', label: 'AUDIO' }];

const p2 = (n: number) => String(n).padStart(2, '0');
const fmtTc = (sec: number) => { const f = Math.max(0, Math.round(sec * FPS)); return `${p2(Math.floor(f / FPS / 60))}:${p2(Math.floor(f / FPS) % 60)}:${p2(f % FPS)}`; };
const fmtMs = (sec: number) => `${Math.floor(sec / 60)}:${p2(Math.floor(sec) % 60)}`;

// used until the server has written a real Flow prompt (or when Gemini is down)
function fallbackFlow(s: EScene, isLong: boolean) {
  const base = (s.prompt || 'misty mountains at dawn, a lone silhouette, warm cinematic light').replace(/[.\s]+$/, '');
  return `${base}. Cinematic ${CAMERA[s.motion] || 'slow push-in'}, natural subtle motion, 8 seconds, ${isLong ? '16:9 landscape' : '9:16 vertical'}, no text, no captions, no logos, no close-up faces.`;
}

// re-time words of a line proportionally (same idea as the server); *word* = emphasis
function retime(text: string, start: number, end: number) {
  const toks = text.split(/\s+/).filter(Boolean).map((t) => ({ text: t.replace(/\*/g, ''), emph: /^\*|\*$/.test(t) })).filter((t) => t.text);
  const wts = toks.map((t) => t.text.length + 2);
  const total = wts.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return toks.map((w, i) => { const d = ((end - start) * wts[i]) / total; const o = { ...w, start: +t.toFixed(3), end: +(t + d).toFixed(3) }; t += d; return o; });
}
const lineText = (l: Project['lines'][number]) => l.words.map((w) => (w.emph ? `*${w.text}*` : w.text)).join(' ');

function Num({ v, on, step = 0.1, min, max }: { v: number; on: (n: number) => void; step?: number; min?: number; max?: number }) {
  return <input type="number" value={+v.toFixed(2)} step={step} min={min} max={max} onChange={(e) => on(parseFloat(e.target.value) || 0)} />;
}
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (<div className="f"><label>{label}</label>{children}</div>);
const Toggle = ({ v, on, label }: { v: boolean; on: (b: boolean) => void; label: string }) => (
  <label className="tg"><input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />{label}</label>
);
const Slider = ({ v, on, min, max, step = 0.01 }: { v: number; on: (n: number) => void; min: number; max: number; step?: number }) => (
  <div className="sl"><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(parseFloat(e.target.value))} /><span>{v.toFixed(2)}</span></div>
);

function App() {
  const [p, setP] = useState<Project | null>(null);
  const [meta, setMeta] = useState({ topic: '', status: '' });
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('scene');
  const [sel, setSel] = useState(0);
  const [frame, setFrame] = useState(0);
  const [saved, setSaved] = useState('Saved');
  const [busy, setBusy] = useState('');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bh, setBh] = useState(330); // height of the bottom area (inspector + timeline), drag the splitter to change
  const [pps, setPps] = useState(50); // timeline zoom: pixels per second
  const [toast, setToast] = useState('');
  const [drop, setDrop] = useState(false);
  const [mb, setMb] = useState({ w: 0, h: 0 }); // size of the monitor area
  const player = useRef<PlayerRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const monBody = useRef<HTMLDivElement>(null);
  const tlScroll = useRef<HTMLDivElement>(null);
  const tlIn = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const fileAll = useRef<HTMLInputElement>(null); // header button: Flow clips from scene 1
  const first = useRef(true);
  const act = useRef<{ toggle: () => void; split: () => void; step: (d: number) => void; seekFrame: (f: number) => void } | null>(null);

  useEffect(() => {
    api(`/reels/${id}/project`).then((r) => {
      if (r.error) setErr(r.error);
      else { setP(r.project); setMeta({ topic: r.topic, status: r.status }); setPps(r.project.format === 'long' ? 10 : 50); }
    });
  }, []);

  // autosave
  useEffect(() => {
    if (!p) return;
    if (first.current) { first.current = false; return; }
    setSaved('Saving...');
    const t = setTimeout(() => api(`/reels/${id}/project`, { method: 'PUT', body: JSON.stringify({ project: p }) }).then((r) => setSaved(r.error ? 'Save failed' : 'Saved')), 900);
    return () => clearTimeout(t);
  }, [p]);

  // player events + monitor size
  useEffect(() => {
    const pl = player.current; if (!pl) return;
    const fu = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const pa = () => setPlaying(true), pz = () => setPlaying(false);
    pl.addEventListener('frameupdate', fu as never); pl.addEventListener('play', pa); pl.addEventListener('pause', pz); pl.addEventListener('ended', pz);
    const el = monBody.current;
    const ro = new ResizeObserver(() => el && setMb({ w: el.clientWidth, h: el.clientHeight }));
    if (el) { ro.observe(el); setMb({ w: el.clientWidth, h: el.clientHeight }); }
    return () => { pl.removeEventListener('frameupdate', fu as never); pl.removeEventListener('play', pa); pl.removeEventListener('pause', pz); pl.removeEventListener('ended', pz); ro.disconnect(); };
  }, [p === null]);

  // keyboard: Space play/pause, S split, arrows step (Shift = 1 s), Home = start
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      const a = act.current; if (!a) return;
      if (e.code === 'Space') { e.preventDefault(); a.toggle(); }
      else if (e.key === 's' || e.key === 'S') a.split();
      else if (e.key === 'ArrowLeft') { e.preventDefault(); a.step(e.shiftKey ? -FPS : -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); a.step(e.shiftKey ? FPS : 1); }
      else if (e.key === 'Home') a.seekFrame(0);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // keep the playhead in view while playing
  useEffect(() => {
    const sc = tlScroll.current; if (!sc || !player.current?.isPlaying()) return;
    const x = LABW + (frame / FPS) * pps;
    if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft + LABW) sc.scrollLeft = Math.max(0, x - 140);
  }, [frame]);

  const up = useCallback((patch: Partial<Project>) => setP((o) => (o ? { ...o, ...patch } : o)), []);
  const upLayout = (patch: Partial<Layout>) => setP((o) => (o ? { ...o, layout: { ...DEFAULT_LAYOUT[o.format], ...o.layout, ...patch } } : o));
  const upScene = (i: number, patch: Partial<EScene>) => setP((o) => (o ? { ...o, scenes: o.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : o));
  const setBoundary = (i: number, v: number) => setP((o) => { // move the cut between scene i and i+1
    if (!o) return o;
    const a = o.scenes[i], b = o.scenes[i + 1]; if (!b) return o;
    const x = +Math.min(Math.max(v, a.start + 0.5), b.end - 0.5).toFixed(2);
    return { ...o, scenes: o.scenes.map((s, k) => (k === i ? { ...s, end: x } : k === i + 1 ? { ...s, start: x } : s)) };
  });

  if (err) return <div className="center"><p>{err}</p><a className="btn" href="/">Back to dashboard</a></div>;
  if (!p) return <div className="center">Loading...</div>;

  const L: Layout = { ...DEFAULT_LAYOUT[p.format], ...p.layout };
  const isLong = p.format === 'long';
  const W = isLong ? 1920 : 1080, H = isLong ? 1080 : 1920;
  const dur = Math.max(1, p.durationSec);
  const total = Math.max(FPS, Math.ceil(p.durationSec * FPS));
  const t = frame / FPS;
  const curScene = Math.max(0, p.scenes.findIndex((s) => t >= s.start && t < s.end));
  const si = Math.min(sel, p.scenes.length - 1);
  const scene = p.scenes[si] || p.scenes[0];
  const seek = (sec: number) => player.current?.seekTo(Math.max(0, Math.min(total - 1, Math.round(sec * FPS))));
  const flowOf = (s: EScene) => s.flow ?? fallbackFlow(s, isLong);
  const laneW = Math.max(120, dur * pps);

  // monitor size: fit the video into the monitor area
  const sc0 = mb.w && mb.h ? Math.min((mb.w - 20) / W, (mb.h - 20) / H) : 0.2;
  const stageW = Math.max(60, Math.floor(W * sc0)), stageH = Math.max(60, Math.floor(H * sc0));

  const toastMsg = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1600); };
  const copy = async (text: string, msg = 'Copied') => {
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toastMsg(msg);
  };
  const allPrompts = () => p.scenes.map((s, i) => `Scene ${i + 1} (${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s)\n${flowOf(s)}`).join('\n\n');
  const dlPrompts = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([allPrompts()], { type: 'text/plain' })); a.download = `flow-prompts-${id}.txt`; a.click(); URL.revokeObjectURL(a.href); };

  const uploadFile = (file: File) => fetch(`/api/reels/${id}/upload?ext=${encodeURIComponent((file.name.split('.').pop() || 'jpg').toLowerCase())}`, { method: 'POST', body: file }).then((x) => x.json());
  const putScene = async (i: number, file: File) => {
    setBusy('Uploading...');
    const r = await uploadFile(file);
    setBusy('');
    if (r.error) { alert(r.error); return false; }
    upScene(i, { type: r.kind === 'video' ? 'video' : 'image', url: r.url, trim: 0 });
    return true;
  };
  // several files at once: file 1 -> scene `start`, file 2 -> next scene ... (sorted by file name, so name your Flow clips 01, 02, 03...)
  const importMany = async (files: File[], start: number) => {
    const ok = files.filter((f) => /^(video|image)\//.test(f.type) || /\.(mp4|mov|webm|jpe?g|png|webp)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!ok.length) return;
    const room = p.scenes.length - start;
    if (ok.length > room && !confirm(`${ok.length} files hain par scene ${start + 1} se aage sirf ${room} scenes bache hain. Pehli ${room} files lagaun?`)) return;
    const list = ok.slice(0, room);
    for (let k = 0; k < list.length; k++) {
      setBusy(`Uploading ${k + 1}/${list.length}...`);
      const r = await uploadFile(list[k]);
      if (r.error) { setBusy(''); alert(`${list[k].name}: ${r.error}`); return; }
      upScene(start + k, { type: r.kind === 'video' ? 'video' : 'image', url: r.url, trim: 0 });
    }
    setBusy('');
    toastMsg(`${list.length} clip(s) scenes par lag gayi`);
  };
  const uploadMusic = async (file: File) => {
    setBusy('Uploading...');
    const r = await uploadFile(file);
    setBusy('');
    if (r.error) return alert(r.error);
    up({ musicUrl: r.url, musicOn: true });
  };
  const aiImage = async (prompt: string) => {
    setBusy('Generating image...');
    const r = await api(`/reels/${id}/scene-image`, { method: 'POST', body: JSON.stringify({ prompt, artStyle: p.style.artStyle }) });
    setBusy('');
    if (r.error) return alert(r.error);
    upScene(si, { type: 'image', url: r.url, trim: 0 });
  };
  const genFlow = async () => {
    setBusy('Flow prompts likh raha hoon...');
    await api(`/reels/${id}/project`, { method: 'PUT', body: JSON.stringify({ project: p }) });
    const r = await api(`/reels/${id}/flow-prompts`, { method: 'POST' });
    setBusy('');
    if (r.error) return alert(r.error);
    const prompts: string[] = r.prompts || [];
    setP((o) => (o ? { ...o, scenes: o.scenes.map((s, i) => ({ ...s, flow: prompts[i] || s.flow })) } : o));
    toastMsg('Flow prompts ready');
  };

  const splitScene = () => {
    const i = curScene, s = p.scenes[i]; if (!s || t <= s.start + 0.5 || t >= s.end - 0.5) return alert('Playhead ko scene ke andar (kinaron se door) rakho');
    const a = { ...s, end: +t.toFixed(2) }, b = { ...s, start: +t.toFixed(2), motion: MOTIONS[(MOTIONS.indexOf(s.motion) + 2) % 5], flow: undefined };
    up({ scenes: [...p.scenes.slice(0, i), a, b, ...p.scenes.slice(i + 1)] }); setSel(i);
  };
  const mergeNext = () => { if (si >= p.scenes.length - 1) return; const a = p.scenes[si], b = p.scenes[si + 1]; up({ scenes: [...p.scenes.slice(0, si), { ...a, end: b.end }, ...p.scenes.slice(si + 2)] }); };

  const render = async () => {
    setBusy('Saving + queueing render...');
    await api(`/reels/${id}/project`, { method: 'PUT', body: JSON.stringify({ project: p }) });
    const r = await api(`/reels/${id}/render`, { method: 'POST' });
    if (r.error) { setBusy(''); return alert(r.error); }
    location.href = '/';
  };

  act.current = {
    toggle: () => player.current?.toggle(),
    split: splitScene,
    step: (d) => seek((player.current?.getCurrentFrame() ?? 0) / FPS + d / FPS),
    seekFrame: (f) => player.current?.seekTo(f),
  };

  // draggable on-canvas elements
  const handles: { key: 'hookY' | 'capY' | 'shlokY' | 'ctaY'; label: string; show: boolean }[] = [
    { key: 'hookY', label: 'Hook', show: L.showHook }, { key: 'capY', label: 'Captions', show: L.showCaptions },
    { key: 'shlokY', label: 'Shlok', show: L.showShlok }, { key: 'ctaY', label: 'CTA', show: L.showCta },
  ];
  const drag = (key: 'hookY' | 'capY' | 'shlokY' | 'ctaY') => (e: React.PointerEvent) => {
    e.preventDefault();
    const box = stage.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => upLayout({ [key]: Math.min(0.96, Math.max(0.04, (ev.clientY - box.top) / box.height)) });
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };

  // timeline: click / drag on the ruler or any empty lane = move the playhead
  const secAt = (clientX: number) => Math.min(dur, Math.max(0, (clientX - tlIn.current!.getBoundingClientRect().left - LABW) / pps));
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    seek(secAt(e.clientX));
    const mv = (ev: PointerEvent) => seek(secAt(ev.clientX));
    const stop = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', stop);
  };
  const dragCut = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const mv = (ev: PointerEvent) => setBoundary(i, secAt(ev.clientX));
    const stop = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', stop);
  };
  const dragSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = bh;
    const mv = (ev: PointerEvent) => setBh(Math.round(Math.min(window.innerHeight - 260, Math.max(200, h0 - (ev.clientY - y0)))));
    const stop = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', stop);
  };
  const step = ([0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 64)) ?? 120;
  const ticks: number[] = []; for (let x = 0; x <= dur; x += step) ticks.push(x);
  const flowReady = p.scenes.filter((s) => s.type === 'video').length;
  const files = (e: React.DragEvent): File[] => Array.from(e.dataTransfer.files || []) as File[];

  return (
    <div className="ed" style={{ ['--bh' as string]: `${bh}px` } as React.CSSProperties}>
      <header>
        <a className="btn sm" href="/">← Dashboard</a>
        <b>{meta.topic}</b><span className="mut">{isLong ? 'Long video' : 'Short'} · {fmtMs(p.durationSec)} · {p.scenes.length} scenes</span>
        <div className="grow" /><span className="mut">{busy || saved}</span>
        <button className="btn" disabled={!!busy} onClick={() => fileAll.current?.click()} title="Flow ke videos select karo: file 1 -> scene 1, file 2 -> scene 2 ... (naam 01, 02, 03 rakho)">⬆ Flow videos</button>
        <input ref={fileAll} type="file" multiple accept="video/mp4,video/webm,video/quicktime,image/*" style={{ display: 'none' }}
          onChange={(e) => { importMany(Array.from(e.target.files || []), 0); e.target.value = ''; }} />
        <button className="btn primary" disabled={!!busy} onClick={render}>Render video</button>
      </header>

      <div className="top">
        {/* ---------------- media bin: every scene as a clip; drop Flow videos here ---------------- */}
        <section className={`pane bin ${drop ? 'drop' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrop(true); }} onDragLeave={() => setDrop(false)}
          onDrop={(e) => { e.preventDefault(); setDrop(false); importMany(files(e), si); }}>
          <div className="ph">Project bin <span className="grow" /><span style={{ color: 'var(--green)' }}>{flowReady}/{p.scenes.length} videos</span></div>
          <div className="pb">
            <div className="bar">
              <button className="btn sm primary" disabled={!!busy} onClick={() => fileIn.current?.click()} title={`Scene ${si + 1} se shuru: file 1 -> scene ${si + 1}, file 2 -> scene ${si + 2} ...`}>⬆ Import clips</button>
              <button className="btn sm" disabled={!!busy} onClick={genFlow}>✨ Flow prompts</button>
              <button className="btn sm" onClick={() => copy(allPrompts(), 'All prompts copied')}>⧉ Copy all</button>
              <button className="btn sm" onClick={dlPrompts}>⭳ .txt</button>
              <input ref={fileIn} type="file" multiple accept="video/mp4,video/webm,video/quicktime,image/*" style={{ display: 'none' }}
                onChange={(e) => { importMany(Array.from(e.target.files || []), si); e.target.value = ''; }} />
            </div>
            <p className="help">Clips ko yahan drag-drop karo ya Import dabao. File 1 selected scene par, file 2 agle par... (naam 01, 02, 03 rakho). Kisi ek card par drop karoge to sirf wahi scene badlega.</p>
            <div className="cards">
              {p.scenes.map((s, i) => (
                <div key={i} className={`card ${isLong ? 'wide' : ''} ${i === si ? 'on' : ''} ${i === curScene ? 'cur' : ''}`}
                  onClick={() => { setSel(i); setTab('scene'); seek(s.start); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrop(false); const f = files(e); if (f.length === 1) putScene(i, f[0]); else importMany(f, i); }}>
                  {s.type === 'video' ? <video className="tn" src={`${s.url}#t=0.1`} muted preload="metadata" />
                    : <div className="tn" style={{ backgroundImage: s.type === 'image' ? `url(${s.url})` : undefined }} />}
                  <span className={`badge ${s.type === 'video' ? 'vid' : ''}`}>{s.type === 'video' ? 'VIDEO' : s.type === 'image' ? 'AI IMG' : 'EMPTY'}</span>
                  <span className="num">{i + 1}</span>
                  <div className="meta"><span>{(s.end - s.start).toFixed(1)}s</span><span>{s.flow ? 'prompt ✓' : ''}</span></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- program monitor ---------------- */}
        <section className="pane mon">
          <div className="ph">Program · {W}×{H} · {FPS} fps <span className="grow" /><span className="mut">Scene {curScene + 1}</span></div>
          <div className="monbody" ref={monBody}>
            <div className="stage" ref={stage} style={{ width: stageW, height: stageH }}>
              <Player ref={player} component={Reel} inputProps={p as unknown as ReelProps} durationInFrames={total} fps={FPS} compositionWidth={W} compositionHeight={H}
                controls={false} clickToPlay numberOfSharedAudioTags={8} acknowledgeRemotionLicense style={{ width: '100%', height: '100%' }} />
              {handles.filter((h) => h.show).map((h) => (
                <div key={h.key} className="handle" style={{ top: `${L[h.key] * 100}%` }} onPointerDown={drag(h.key)} title="Drag up/down">
                  <span>⇅ {h.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="trans">
            <button className="btn sm ic" title="Start (Home)" onClick={() => seek(0)}>⏮</button>
            <button className="btn sm ic" title="-1 s (Shift+←)" onClick={() => seek(t - 1)}>⏪</button>
            <button className="btn sm ic primary" title="Play / pause (Space)" onClick={() => player.current?.toggle()}>{playing ? '⏸' : '▶'}</button>
            <button className="btn sm ic" title="+1 s (Shift+→)" onClick={() => seek(t + 1)}>⏩</button>
            <button className="btn sm ic" title="End" onClick={() => seek(dur)}>⏭</button>
            <span className="tc mono">{fmtTc(t)}</span>
            <span className="mut mono">/ {fmtTc(p.durationSec)}</span>
            <button className="btn sm ic" title="Mute preview" onClick={() => { const pl = player.current; if (!pl) return; if (pl.isMuted()) { pl.unmute(); setMuted(false); } else { pl.mute(); setMuted(true); } }}>{muted ? '🔇' : '🔊'}</button>
          </div>
        </section>
      </div>

      <div className="split" onPointerDown={dragSplit} title="Drag to resize" />

      <div className="bot">
        {/* ---------------- inspector ---------------- */}
        <section className="pane insp">
          <div className="ph">Inspector · {TABS.find((x) => x.k === tab)?.label}</div>
          <div className="pb pbody">
            {tab === 'elements' && (<>
              <p className="help">Preview par Hook / Captions / Shlok / CTA ke handle ko upar-neeche drag karo.</p>
              <h4>Hook</h4>
              <Row label="Text"><input value={p.hook} onChange={(e) => up({ hook: e.target.value })} /></Row>
              <Toggle v={L.showHook} on={(b) => upLayout({ showHook: b })} label="Show hook" />
              <Row label="Size"><Slider v={L.hookSize} on={(n) => upLayout({ hookSize: n })} min={0.5} max={1.6} /></Row>
              <h4>Captions</h4>
              <Toggle v={L.showCaptions} on={(b) => upLayout({ showCaptions: b })} label="Show captions" />
              <Row label="Size"><Slider v={L.capSize} on={(n) => upLayout({ capSize: n })} min={0.5} max={1.6} /></Row>
              <h4>Shlok card{p.shloks.length > 1 ? 's' : ''}</h4>
              <Toggle v={L.showShlok} on={(b) => upLayout({ showShlok: b })} label="Show shlok card" />
              {p.shloks.map((s, i) => (
                <div className="ln" key={i}>
                  <Row label={`Sanskrit ${i + 1}`}><textarea rows={3} value={s.sanskrit} onChange={(e) => up({ shloks: p.shloks.map((x, k) => (k === i ? { ...x, sanskrit: e.target.value } : x)) })} /></Row>
                  <div className="two"><Row label="Reference"><input value={s.reference} onChange={(e) => up({ shloks: p.shloks.map((x, k) => (k === i ? { ...x, reference: e.target.value } : x)) })} /></Row>
                    <Row label="From / to (s)"><div className="two"><Num v={s.from} on={(n) => up({ shloks: p.shloks.map((x, k) => (k === i ? { ...x, from: n } : x)) })} /><Num v={s.to} on={(n) => up({ shloks: p.shloks.map((x, k) => (k === i ? { ...x, to: n } : x)) })} /></div></Row></div>
                </div>
              ))}
              <h4>CTA / end text</h4>
              <Row label="Text"><input value={p.cta} onChange={(e) => up({ cta: e.target.value })} /></Row>
              <Toggle v={L.showCta} on={(b) => upLayout({ showCta: b })} label="Show CTA" />
              <h4>Channel watermark</h4>
              <Row label="Text"><input value={p.channel} onChange={(e) => up({ channel: e.target.value })} placeholder="@yourchannel" /></Row>
              {isLong && (<><h4>Chapters</h4>{p.chapters.map((c, i) => (
                <div className="two" key={i}><input value={c.title} onChange={(e) => up({ chapters: p.chapters.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} /><Num v={c.at} on={(n) => up({ chapters: p.chapters.map((x, k) => (k === i ? { ...x, at: n } : x)) })} /></div>
              ))}</>)}
              <h4>Overlays</h4>
              <Toggle v={L.showProgress} on={(b) => upLayout({ showProgress: b })} label="Progress bar" />
              <Toggle v={L.showGrain} on={(b) => upLayout({ showGrain: b })} label="Film grain" />
              <Toggle v={L.showDust} on={(b) => upLayout({ showDust: b })} label="Floating dust" />
            </>)}

            {tab === 'scene' && scene && (<>
              <div className="row"><button className="btn sm" onClick={splitScene}>✂ Split at playhead (S)</button><button className="btn sm" onClick={mergeNext} disabled={si >= p.scenes.length - 1}>Merge with next</button></div>
              <h4>Scene {si + 1} / {p.scenes.length} · {fmtMs(scene.start)} – {fmtMs(scene.end)} · {(scene.end - scene.start).toFixed(1)}s</h4>
              <div className="thumb">{scene.type === 'image' ? <img src={scene.url} /> : scene.type === 'video' ? <video src={scene.url} muted controls /> : <div className="none">No visual</div>}</div>

              <div className="flow">
                <h4 style={{ marginTop: 0, color: 'var(--accent)' }}>Google Flow prompt</h4>
                <p className="help">Ye prompt Flow mein paste karo ({isLong ? '16:9' : '9:16'}, 8 sec clip). Video download karke neeche upload karo ya bin mein drop karo.</p>
                <textarea rows={6} value={flowOf(scene)} onChange={(e) => upScene(si, { flow: e.target.value })} />
                <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button className="btn sm primary" onClick={() => copy(flowOf(scene))}>⧉ Copy prompt</button>
                  <a className="btn sm" href="https://labs.google/fx/tools/flow" target="_blank" rel="noopener noreferrer">Open Flow ↗</a>
                  <button className="btn sm" disabled={!!busy} onClick={genFlow} title="Sab scenes ke naye prompts (purane badal jayenge)">✨ Rewrite all</button>
                </div>
              </div>
              <Row label="Upload the Flow video (or any image / video) for this scene"><input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" onChange={(e) => { const f = e.target.files?.[0]; if (f) putScene(si, f); e.target.value = ''; }} /></Row>
              {scene.type === 'video' && <p className="warn">Flow clip 8 s ki hoti hai, ye scene {(scene.end - scene.start).toFixed(1)} s ka hai.{scene.end - scene.start > 8 ? ' Scene 8 s se lamba hai: Split karo ya cut time kam karo.' : ' Baaki hissa kat jayega (Video start offset se choose karo).'}</p>}
              <Row label="Or generate a new AI image (English prompt)"><textarea id="aip" rows={3} defaultValue={scene.prompt || ''} placeholder="silhouette of a man on a cliff at dawn, mist, warm light" key={si} /></Row>
              <button className="btn sm" disabled={!!busy} onClick={() => aiImage((document.getElementById('aip') as HTMLTextAreaElement).value)}>Generate image</button>
              <div className="two" style={{ marginTop: 12 }}>
                <Row label="Motion"><select value={scene.motion} onChange={(e) => upScene(si, { motion: e.target.value as Scene['motion'] })}>{MOTIONS.map((m) => <option key={m}>{m}</option>)}</select></Row>
                <Row label="Transition (all scenes)"><select value={p.style.transition} onChange={(e) => up({ style: { ...p.style, transition: e.target.value as never } })}>{['fade', 'zoom', 'slide', 'flash'].map((m) => <option key={m}>{m}</option>)}</select></Row>
              </div>
              {scene.type === 'video' && <Row label="Video start offset (s)"><Num v={scene.trim} on={(n) => upScene(si, { trim: Math.max(0, n) })} /></Row>}
              {si < p.scenes.length - 1 && <Row label="Cut to next scene at (s)"><Num v={scene.end} step={0.1} on={(n) => setBoundary(si, n)} /></Row>}
              <button className="btn sm bad" onClick={() => upScene(si, { type: 'none', url: '' })}>Remove visual</button>
            </>)}

            {tab === 'captions' && (<>
              <p className="help">Text badlo, *star* laga kar key word highlight karo. Awaaz ka timing fixed hai; naya voice chahiye to dashboard ka "Edit script" use karo.</p>
              {p.lines.map((l, i) => (
                <div className="ln" key={i}>
                  <div className="lh"><a onClick={() => seek(l.start)}>{l.start.toFixed(1)}s</a><span>→ {l.end.toFixed(1)}s</span></div>
                  <textarea rows={2} defaultValue={lineText(l)} onBlur={(e) => up({ lines: p.lines.map((x, k) => (k === i ? { ...x, words: retime(e.target.value, x.start, x.end) } : x)) })} />
                </div>
              ))}
            </>)}

            {tab === 'style' && (<>
              <Row label="Colour theme"><select value={p.style.templateId} onChange={(e) => up({ style: { ...p.style, templateId: e.target.value } })}>{Object.keys(TEMPLATES).map((k) => <option key={k}>{k}</option>)}</select></Row>
              <div className="two">
                <Row label="Accent colour"><input type="color" value={p.accent || TEMPLATES[p.style.templateId]?.accent || '#f5c451'} onChange={(e) => up({ accent: e.target.value })} /></Row>
                <Row label="Text colour"><input type="color" value={p.textColor || TEMPLATES[p.style.templateId]?.text || '#ffffff'} onChange={(e) => up({ textColor: e.target.value })} /></Row>
              </div>
              <button className="btn sm" onClick={() => up({ accent: '', textColor: '' })}>Reset colours</button>
              <Row label="Video format (layout)"><select value={p.style.variant || 'classic'} onChange={(e) => { const v = e.target.value as Variant; setP((o) => (o ? { ...o, style: { ...o.style, variant: v }, layout: { ...DEFAULT_LAYOUT[o.format], ...o.layout, ...(o.format === 'short' ? { hookY: DEFAULT_LAYOUT.short.hookY, hookSize: 1, capY: DEFAULT_LAYOUT.short.capY, capSize: 1, shlokY: DEFAULT_LAYOUT.short.shlokY, ctaY: DEFAULT_LAYOUT.short.ctaY, showProgress: true, ...VARIANT_LAYOUT[v] } : {}) } } : o)); }} disabled={p.format === 'long'}>{VARIANTS_LIST.map((m) => <option key={m} value={m}>{({ classic: 'classic (big hook, captions, CTA)', headline: 'headline (title stays on top)', kinetic: 'kinetic (one big word at a time)', frame: 'frame (picture in a window)', cinema: 'cinema (black bars + subtitles)' } as Record<string, string>)[m]}</option>)}</select></Row>
              <Row label="Caption style"><select value={p.style.captionStyle} onChange={(e) => up({ style: { ...p.style, captionStyle: e.target.value as never } })}>{['pop', 'box', 'glow'].map((m) => <option key={m}>{m}</option>)}</select></Row>
              <Row label="Hook style"><select value={p.style.hookStyle} onChange={(e) => up({ style: { ...p.style, hookStyle: e.target.value as never } })}>{['big', 'band'].map((m) => <option key={m}>{m}</option>)}</select></Row>
              <Row label="Shlok card style"><select value={p.style.shlokStyle} onChange={(e) => up({ style: { ...p.style, shlokStyle: e.target.value as never } })}>{['card', 'minimal', 'band'].map((m) => <option key={m}>{m}</option>)}</select></Row>
            </>)}

            {tab === 'audio' && (<>
              <Row label="Voice volume"><Slider v={L.voiceVolume} on={(n) => upLayout({ voiceVolume: n })} min={0} max={1.5} /></Row>
              <Toggle v={p.musicOn !== false} on={(b) => up({ musicOn: b })} label="Background music" />
              <Row label="Music volume"><Slider v={p.musicVolume} on={(n) => up({ musicVolume: n })} min={0} max={0.8} /></Row>
              <Row label="Use your own music file"><input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMusic(f); e.target.value = ''; }} /></Row>
              <p className="help">Voice segments: {p.audio.length}. Music voice ke neeche apne aap dabta hai.</p>
            </>)}
          </div>
        </section>

        {/* ---------------- multi-track timeline ---------------- */}
        <section className="pane tlp">
          <div className="tltools">
            <button className="btn sm ic" onClick={() => player.current?.toggle()} title="Play / pause (Space)">{playing ? '⏸' : '▶'}</button>
            <span className="tc mono" style={{ fontSize: 13, minWidth: 96 }}>{fmtTc(t)}</span>
            <button className="btn sm" onClick={splitScene} title="Split scene at playhead (S)">✂ Split</button>
            <button className="btn sm" onClick={mergeNext} disabled={si >= p.scenes.length - 1}>Merge</button>
            <div className="grow" />
            <span className="mut">Zoom</span>
            <input type="range" min={4} max={160} step={1} value={pps} onChange={(e) => setPps(parseInt(e.target.value, 10))} />
          </div>
          <div className="tlscroll" ref={tlScroll}>
            <div className="tlin" ref={tlIn} style={{ width: LABW + laneW, ['--pps' as string]: pps } as React.CSSProperties}>
              <div className="row-t ruler">
                <div className="lab">TIME</div>
                <div className="lane" style={{ width: laneW, background: 'none' }} onPointerDown={scrub}>
                  {ticks.map((x) => <div key={x} className="tick" style={{ left: x * pps }}>{fmtMs(x)}{x % 1 ? '.5' : ''}</div>)}
                  {p.chapters.map((c, i) => <div key={i} className="chapm" style={{ left: c.at * pps }} title={c.title} />)}
                </div>
              </div>

              <div className="row-t" style={{ height: 56 }}>
                <div className="lab"><i>V1</i>Visuals</div>
                <div className="lane" style={{ width: laneW }} onPointerDown={scrub}>
                  {p.scenes.map((s, i) => (
                    <React.Fragment key={i}>
                      <div className={`clip v ${s.type === 'video' ? 'vid' : s.type === 'none' ? 'none' : ''} ${i === si ? 'sel' : ''}`}
                        style={{ left: s.start * pps, width: Math.max(4, (s.end - s.start) * pps - 1), backgroundImage: s.type === 'image' ? `url(${s.url})` : undefined }}
                        onPointerDown={(e) => e.stopPropagation()} onClick={() => { setSel(i); setTab('scene'); seek(s.start); }}>
                        <span>{i + 1}{s.type === 'video' ? ' ▶' : ''}</span>
                      </div>
                      {i < p.scenes.length - 1 && <div className="cut" style={{ left: s.end * pps }} onPointerDown={dragCut(i)} title="Drag to move the cut" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="row-t">
                <div className="lab"><i>T1</i>Captions</div>
                <div className="lane" style={{ width: laneW }} onPointerDown={scrub}>
                  {p.lines.map((l, i) => (
                    <div key={i} className="clip c" style={{ left: l.start * pps, width: Math.max(4, (l.end - l.start) * pps - 1) }}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => { seek(l.start); setTab('captions'); }} title={lineText(l)}>
                      {l.words.map((w) => w.text).join(' ')}
                    </div>
                  ))}
                </div>
              </div>

              {p.shloks.length > 0 && (
                <div className="row-t">
                  <div className="lab"><i>S1</i>Shlok</div>
                  <div className="lane" style={{ width: laneW }} onPointerDown={scrub}>
                    {p.shloks.map((s, i) => (
                      <div key={i} className="clip s" style={{ left: s.from * pps, width: Math.max(4, (s.to - s.from) * pps - 1) }}
                        onPointerDown={(e) => e.stopPropagation()} onClick={() => { seek(s.from); setTab('elements'); }}>{s.reference || 'Shlok'}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="row-t">
                <div className="lab"><i>A1</i>Voice</div>
                <div className="lane" style={{ width: laneW }} onPointerDown={scrub}>
                  {p.audio.map((a, i) => <div key={i} className="clip a" style={{ left: a.start * pps, width: Math.max(3, a.duration * pps - 1), cursor: 'default' }} />)}
                </div>
              </div>

              <div className="row-t">
                <div className="lab"><i>A2</i>Music</div>
                <div className="lane" style={{ width: laneW }} onPointerDown={scrub}>
                  {p.musicOn !== false && <div className="clip m" style={{ left: 0, width: dur * pps, cursor: 'default' }}>{p.musicUrl ? 'Your music' : 'Ambience'}</div>}
                </div>
              </div>

              <div className="ph-line" style={{ left: LABW + t * pps }} />
            </div>
          </div>
        </section>
      </div>

      <nav className="strip">
        {TABS.map((x) => <button key={x.k} className={tab === x.k ? 'on' : ''} onClick={() => setTab(x.k)}>{x.label}</button>)}
      </nav>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
