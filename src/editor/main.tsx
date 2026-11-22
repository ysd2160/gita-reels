import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { DEFAULT_LAYOUT, Layout, Reel, ReelProps, Scene, VARIANTS_LIST, VARIANT_LAYOUT, Variant } from '../remotion/Reel';
import { TEMPLATES } from '../remotion/templates';

const FPS = 30;
const id = new URLSearchParams(location.search).get('id') || '';
const api = (p: string, o: RequestInit = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then((r) => r.json());

type Project = ReelProps;
const MOTIONS = ['in', 'out', 'left', 'right', 'up'] as const;

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
  const [tab, setTab] = useState<'elements' | 'scenes' | 'captions' | 'style' | 'audio'>('elements');
  const [sel, setSel] = useState(0);
  const [frame, setFrame] = useState(0);
  const [saved, setSaved] = useState('Saved');
  const [busy, setBusy] = useState('');
  const player = useRef<PlayerRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    api(`/reels/${id}/project`).then((r) => { if (r.error) setErr(r.error); else { setP(r.project); setMeta({ topic: r.topic, status: r.status }); } });
  }, []);

  // autosave
  useEffect(() => {
    if (!p) return;
    if (first.current) { first.current = false; return; }
    setSaved('Saving...');
    const t = setTimeout(() => api(`/reels/${id}/project`, { method: 'PUT', body: JSON.stringify({ project: p }) }).then((r) => setSaved(r.error ? 'Save failed' : 'Saved')), 900);
    return () => clearTimeout(t);
  }, [p]);

  useEffect(() => {
    const pl = player.current; if (!pl) return;
    const h = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    pl.addEventListener('frameupdate', h as never);
    return () => pl.removeEventListener('frameupdate', h as never);
  }, [p === null]);

  const up = useCallback((patch: Partial<Project>) => setP((o) => (o ? { ...o, ...patch } : o)), []);
  const upLayout = (patch: Partial<Layout>) => setP((o) => (o ? { ...o, layout: { ...DEFAULT_LAYOUT[o.format], ...o.layout, ...patch } } : o));
  const upScene = (i: number, patch: Partial<Scene>) => setP((o) => (o ? { ...o, scenes: o.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : o));

  if (err) return <div className="center"><p>{err}</p><a className="btn" href="/">Back to dashboard</a></div>;
  if (!p) return <div className="center">Loading...</div>;

  const L: Layout = { ...DEFAULT_LAYOUT[p.format], ...p.layout };
  const isLong = p.format === 'long';
  const W = isLong ? 1920 : 1080, H = isLong ? 1080 : 1920;
  const total = Math.max(FPS, Math.ceil(p.durationSec * FPS));
  const t = frame / FPS;
  const curScene = Math.max(0, p.scenes.findIndex((s) => t >= s.start && t < s.end));
  const scene = p.scenes[sel] || p.scenes[0];
  const seek = (sec: number) => player.current?.seekTo(Math.round(sec * FPS));

  const upload = async (file: File, kind: 'scene' | 'music') => {
    setBusy('Uploading...');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const r = await fetch(`/api/reels/${id}/upload?ext=${ext}`, { method: 'POST', body: file }).then((x) => x.json());
    setBusy('');
    if (r.error) return alert(r.error);
    if (kind === 'music') up({ musicUrl: r.url, musicOn: true });
    else upScene(sel, { type: r.kind === 'video' ? 'video' : 'image', url: r.url, trim: 0 });
  };
  const aiImage = async (prompt: string) => {
    setBusy('Generating image...');
    const r = await api(`/reels/${id}/scene-image`, { method: 'POST', body: JSON.stringify({ prompt, artStyle: p.style.artStyle }) });
    setBusy('');
    if (r.error) return alert(r.error);
    upScene(sel, { type: 'image', url: r.url, trim: 0 });
  };
  const splitScene = () => {
    const i = curScene, s = p.scenes[i]; if (!s || t <= s.start + 0.5 || t >= s.end - 0.5) return alert('Playhead ko scene ke andar (kinaron se door) rakho');
    const a = { ...s, end: +t.toFixed(2) }, b = { ...s, start: +t.toFixed(2), motion: MOTIONS[(MOTIONS.indexOf(s.motion) + 2) % 5] };
    up({ scenes: [...p.scenes.slice(0, i), a, b, ...p.scenes.slice(i + 1)] }); setSel(i);
  };
  const mergeNext = () => { if (sel >= p.scenes.length - 1) return; const a = p.scenes[sel], b = p.scenes[sel + 1]; up({ scenes: [...p.scenes.slice(0, sel), { ...a, end: b.end }, ...p.scenes.slice(sel + 2)] }); };
  const setBoundary = (i: number, v: number) => { // move the cut between scene i and i+1
    const a = p.scenes[i], b = p.scenes[i + 1]; if (!b) return;
    const x = Math.min(Math.max(v, a.start + 0.5), b.end - 0.5);
    setP({ ...p, scenes: p.scenes.map((s, k) => (k === i ? { ...s, end: x } : k === i + 1 ? { ...s, start: x } : s)) });
  };

  const render = async () => {
    setBusy('Saving + queueing render...');
    await api(`/reels/${id}/project`, { method: 'PUT', body: JSON.stringify({ project: p }) });
    const r = await api(`/reels/${id}/render`, { method: 'POST' });
    if (r.error) { setBusy(''); return alert(r.error); }
    location.href = '/';
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

  return (
    <div className="ed">
      <header>
        <a className="btn sm" href="/">← Dashboard</a>
        <b>{meta.topic}</b><span className="mut">{isLong ? 'Long video' : 'Short'} · {p.durationSec.toFixed(0)}s</span>
        <div className="grow" /><span className="mut">{busy || saved}</span>
        <button className="btn primary" disabled={!!busy} onClick={render}>Render video</button>
      </header>
      <div className="body">
        <div className="stagewrap">
          <div className="stage" ref={stage} style={{ aspectRatio: `${W}/${H}` }}>
            <Player ref={player} component={Reel} inputProps={p} durationInFrames={total} fps={FPS} compositionWidth={W} compositionHeight={H}
              controls clickToPlay={false} numberOfSharedAudioTags={8} acknowledgeRemotionLicense style={{ width: '100%', height: '100%' }} />
            {handles.filter((h) => h.show).map((h) => (
              <div key={h.key} className="handle" style={{ top: `${L[h.key] * 100}%` }} onPointerDown={drag(h.key)} title="Drag up/down">
                <span>⇅ {h.label}</span>
              </div>
            ))}
          </div>
          <div className="tl">
            <div className="tl-scenes">
              {p.scenes.map((s, i) => (
                <div key={i} className={`blk ${i === sel ? 'on' : ''} ${i === curScene ? 'cur' : ''}`} style={{ flex: s.end - s.start, backgroundImage: s.type === 'image' ? `url(${s.url})` : undefined }}
                  onClick={() => { setSel(i); setTab('scenes'); seek(s.start); }}><i>{i + 1}</i></div>
              ))}
              {p.chapters.map((c, i) => <div key={i} className="chap" style={{ left: `${(c.at / p.durationSec) * 100}%` }} title={c.title} />)}
              <div className="head" style={{ left: `${(t / p.durationSec) * 100}%` }} />
            </div>
          </div>
        </div>

        <aside className="panel">
          <nav>{(['elements', 'scenes', 'captions', 'style', 'audio'] as const).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>)}</nav>
          <div className="pbody">
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

            {tab === 'scenes' && scene && (<>
              <div className="row"><button className="btn sm" onClick={splitScene}>Split at playhead</button><button className="btn sm" onClick={mergeNext} disabled={sel >= p.scenes.length - 1}>Merge with next</button></div>
              <h4>Scene {sel + 1} / {p.scenes.length}</h4>
              <div className="thumb">{scene.type === 'image' ? <img src={scene.url} /> : scene.type === 'video' ? <video src={scene.url} muted /> : <div className="none">No visual</div>}</div>
              <Row label="Replace with your own image / video"><input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'scene')} /></Row>
              <Row label="Or generate a new AI image (English prompt)"><textarea id="aip" rows={3} placeholder="silhouette of a man on a cliff at dawn, mist, warm light" /></Row>
              <button className="btn sm" disabled={!!busy} onClick={() => aiImage((document.getElementById('aip') as HTMLTextAreaElement).value)}>Generate</button>
              <div className="two" style={{ marginTop: 12 }}>
                <Row label="Motion"><select value={scene.motion} onChange={(e) => upScene(sel, { motion: e.target.value as Scene['motion'] })}>{MOTIONS.map((m) => <option key={m}>{m}</option>)}</select></Row>
                <Row label="Transition (all scenes)"><select value={p.style.transition} onChange={(e) => up({ style: { ...p.style, transition: e.target.value as never } })}>{['fade', 'zoom', 'slide', 'flash'].map((m) => <option key={m}>{m}</option>)}</select></Row>
              </div>
              {scene.type === 'video' && <Row label="Video start offset (s)"><Num v={scene.trim} on={(n) => upScene(sel, { trim: Math.max(0, n) })} /></Row>}
              {sel < p.scenes.length - 1 && <Row label="Cut to next scene at (s)"><Num v={scene.end} step={0.1} on={(n) => setBoundary(sel, n)} /></Row>}
              <button className="btn sm bad" onClick={() => upScene(sel, { type: 'none', url: '' })}>Remove visual</button>
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
              <Row label="Use your own music file"><input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'music')} /></Row>
              <p className="help">Voice segments: {p.audio.length}. Music voice ke neeche apne aap dabta hai.</p>
            </>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
