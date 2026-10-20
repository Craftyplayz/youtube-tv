import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { api, go, now, schedule, type Lineup, type Slot } from './api.ts';
import Guide from './Guide.tsx';
import Icon, { type IconName } from './Icon.tsx';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void }
}

const ytReady = new Promise<void>(resolve => {
  window.onYouTubeIframeAPIReady = resolve;
  document.head.append(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api' }));
});

// Browsers only allow sound after a click or key press, so a Channel page opened directly asks for one first
let interacted = false;
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { interacted = true; }, { once: true, capture: true });

const UNPLAYABLE = [100, 101, 150]; // removed, private, or embedding disabled
const LIVE_WITHIN = 15_000;

function clock(ms: number) {
  const s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Per-Screen preferences; everything still works if the browser blocks storage
function load(key: string, fallback: number) {
  try {
    const n = Number(localStorage.getItem(key) ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* storage blocked */ }
}

const toggleFullscreen = () =>
  (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

function Ctl({ label, icon, ...rest }: { label: string; icon: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button title={label} aria-label={label} {...rest}><Icon name={icon} /></button>;
}

export default function Player({ slug }: { slug: string }) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null);
  const startedRef = useRef(false);
  const cur = useRef<{ channel: number; slot: Slot | null }>({ channel: 0, slot: null });
  const hideTimer = useRef(0);
  const overControls = useRef(false);
  const rightDown = useRef(false);
  const captionsFor = useRef('');
  const vol = useRef(load('volume', 100));
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [started, setStarted] = useState(false);
  const [guide, setGuide] = useState(false);
  const [pos, setPos] = useState(0); // seconds into the current video
  const [ui, setUi] = useState(true);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [background, setBackground] = useState(document.hidden);
  const [flash, setFlash] = useState<{ icon: IconName; key: number } | null>(null);
  const [volume, setVolume] = useState(vol.current);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(() => load('captions', 0) === 1);
  const captionsOn = useRef(captions);
  captionsOn.current = captions;
  const target = lineups?.find(l => l.slug === slug);

  useEffect(() => {
    schedule(now(), now() + 1).then(setLineups);
    const t = setInterval(() => {
      const time = yt.current?.getCurrentTime?.();
      if (time !== undefined) setPos(time);
    }, 500);
    const onFullscreen = () => {
      setFullscreen(!!document.fullscreenElement);
      // YouTube's player brings its own captions back after resizing into or out of full screen; restore the viewer's choice once it settles
      for (const ms of [300, 1000]) setTimeout(() => applyCaptions(captionsOn.current), ms);
    };
    const onVisibility = () => setBackground(document.hidden);
    addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      clearTimeout(hideTimer.current);
      removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => { if (target && interacted) start(); }, [lineups]);

  function showUi(ms: number) {
    setUi(true);
    clearTimeout(hideTimer.current);
    // Stays up while the mouse rests on the controls
    hideTimer.current = window.setTimeout(() => (overControls.current ? showUi(ms) : setUi(false)), ms);
  }

  function play(channel: number, slot: Slot | null, fromStart: boolean) {
    cur.current = { channel, slot };
    captionsFor.current = '';
    setPos(0);
    showUi(4000);
    if (!slot) {
      yt.current.stopVideo();
      setTimeout(() => cur.current.channel === channel && !cur.current.slot && live(channel), 30_000); // off air: look again soon
      return;
    }
    yt.current.loadVideoById({ videoId: slot.videoId, startSeconds: fromStart ? 0 : (now() - slot.start) / 1000 });
  }

  async function live(channel: number) {
    const [l] = await schedule(now(), now() + 1, channel);
    if (cur.current.channel === channel) play(channel, l?.slots[0] ?? null, false);
  }

  function tuneIn(channel: number, slot?: Slot) {
    cur.current.channel = channel;
    const l = lineups?.find(x => x.id === channel);
    if (l) {
      history.replaceState(null, '', '/' + l.slug); // each Channel has its own address
      document.title = `${l.name} · Youtube TV`;
    }
    api(`channels/${channel}/tune`, 'POST').catch(() => {}); // lets this Channel's New uploads get queued
    return slot ? play(channel, slot, true) : live(channel);
  }

  async function next() {
    const { channel, slot } = cur.current;
    if (!slot) return live(channel);
    const [l] = await schedule(slot.start, slot.end + 1, channel);
    if (cur.current.channel !== channel) return;
    const slots = l?.slots ?? [];
    const i = slots.findIndex(s => s.start === slot.start && s.videoId === slot.videoId);
    // Never jump mid-video: if the Schedule changed under us, play whatever now covers this video's end, from its start
    play(channel, (i >= 0 ? slots[i + 1] : slots.find(s => s.start <= slot.end && s.end > slot.end)) ?? null, true);
  }

  async function previous() {
    const { channel, slot } = cur.current;
    if (!slot) return;
    const [l] = await schedule(slot.start - 12 * 3_600_000, slot.start, channel);
    const prev = l?.slots.filter(s => s.start < slot.start).at(-1);
    if (prev && cur.current.channel === channel) play(channel, prev, true);
  }

  function flip(step: number) {
    if (!lineups?.length) return;
    const i = lineups.findIndex(l => l.id === cur.current.channel);
    tuneIn(lineups[(i + step + lineups.length) % lineups.length].id);
  }

  function togglePause() {
    const p = yt.current;
    if (!p?.getPlayerState) return;
    const playing = p.getPlayerState() === window.YT.PlayerState.PLAYING;
    if (playing) p.pauseVideo();
    else p.playVideo();
    setFlash({ icon: playing ? 'pause' : 'play', key: Date.now() });
  }

  function seekBy(seconds: number) {
    const p = yt.current;
    if (p?.getCurrentTime) p.seekTo(Math.max(0, p.getCurrentTime() + seconds), true);
  }

  // Seeking anywhere in the video just changes this Screen's Time-shift
  function seekToPointer(clientX: number, final: boolean) {
    const slot = cur.current.slot;
    const el = bar.current;
    if (!slot || !el) return;
    const r = el.getBoundingClientRect();
    const t = (Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (slot.end - slot.start)) / 1000;
    yt.current?.seekTo(t, final);
    setPos(t);
  }

  // shortcut: loadModule/unloadModule('captions') is undocumented YouTube player API; if YouTube drops it, captions follow YouTube's own default
  function applyCaptions(on: boolean) {
    try {
      if (on) yt.current?.loadModule('captions');
      else {
        yt.current?.setOption('captions', 'track', {});
        yt.current?.unloadModule('captions');
      }
    } catch { /* player not ready yet */ }
  }

  function toggleCaptions() {
    const on = !captions;
    setCaptions(on);
    store('captions', on ? 1 : 0);
    applyCaptions(on);
    showUi(1500);
  }

  function changeVolume(v: number) {
    const level = Math.max(0, Math.min(100, Math.round(v)));
    vol.current = level;
    setVolume(level);
    store('volume', level);
    yt.current?.setVolume(level);
    if (level > 0) {
      yt.current?.unMute();
      setMuted(false);
    }
    showUi(1500);
  }

  function toggleMute() {
    if (muted || vol.current === 0) {
      yt.current?.unMute();
      setMuted(false);
      if (vol.current === 0) changeVolume(50);
    } else {
      yt.current?.mute();
      setMuted(true);
    }
    showUi(1500);
  }

  async function exclude() {
    const { channel, slot } = cur.current;
    const name = lineups?.find(l => l.id === channel)?.name;
    if (!slot || !confirm(`Never show “${slot.title}” on ${name} again?`)) return;
    await api(`channels/${channel}/exclusions`, 'POST', { videoId: slot.videoId }).then(next, e => alert(e.message));
  }

  async function start() {
    if (startedRef.current || !target) return;
    startedRef.current = true;
    setStarted(true);
    await ytReady;
    yt.current = new window.YT.Player(box.current!.appendChild(document.createElement('div')), {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3 },
      events: {
        onReady: () => {
          yt.current.setVolume(vol.current);
          tuneIn(target.id);
        },
        onStateChange: (e: { data: number }) => {
          const { ENDED, PLAYING, PAUSED } = window.YT.PlayerState;
          if (e.data === ENDED) next();
          if (e.data === PLAYING || e.data === PAUSED) setPaused(e.data === PAUSED);
          // Captions reset with every new video, so re-apply the choice once each one starts
          const id = cur.current.slot?.videoId ?? '';
          if (e.data === PLAYING && captionsFor.current !== id) {
            captionsFor.current = id;
            applyCaptions(captionsOn.current);
          }
        },
        // Fires when YouTube loads its captions module by itself; unload it again if the viewer turned captions off
        onApiChange: () => {
          if (!captionsOn.current && yt.current.getOptions?.().includes('captions')) applyCaptions(false);
        },
        onError: (e: { data: number }) => {
          const s = cur.current.slot;
          if (s && UNPLAYABLE.includes(e.data)) api(`videos/${s.videoId}/broken`, 'POST').catch(() => {});
          next();
        },
      },
    });
  }

  const restart = () => yt.current?.seekTo(0, true);
  const goLive = () => live(cur.current.channel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started) return void start();
      if (guide) {
        if (e.key === 'Escape' || e.key === 'g') setGuide(false);
        return;
      }
      switch (e.key) {
        case 'ArrowUp': flip(1); break;
        case 'ArrowDown': flip(-1); break;
        case 'ArrowLeft': seekBy(-5); break;
        case 'ArrowRight': seekBy(5); break;
        case 'N': next(); break;
        case 'P': previous(); break;
        case ' ': case 'k': togglePause(); break;
        case 'm': toggleMute(); break;
        case 'g': setGuide(true); break;
        case 'r': restart(); break;
        case 'l': goLive(); break;
        case 'c': toggleCaptions(); break;
        case 'f': toggleFullscreen(); break;
        case 'Escape': go('/'); break;
        default: return;
      }
      e.preventDefault();
      showUi(2500);
    };
    const onDown = (e: MouseEvent) => { if (e.button === 2) rightDown.current = true; };
    const onUp = (e: MouseEvent) => { if (e.button === 2) rightDown.current = false; };
    const onBlur = () => { rightDown.current = false; };
    // Hold right-click and scroll to change volume
    const onWheel = (e: WheelEvent) => {
      if (!started || !rightDown.current) return;
      e.preventDefault();
      changeVolume(vol.current - Math.sign(e.deltaY) * 5);
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    addEventListener('keydown', onKey);
    addEventListener('mousedown', onDown);
    addEventListener('mouseup', onUp);
    addEventListener('blur', onBlur);
    addEventListener('wheel', onWheel, { passive: false });
    addEventListener('contextmenu', noMenu);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('mousedown', onDown);
      removeEventListener('mouseup', onUp);
      removeEventListener('blur', onBlur);
      removeEventListener('wheel', onWheel);
      removeEventListener('contextmenu', noMenu);
    };
  });

  const slot = cur.current.slot;
  const index = lineups?.findIndex(l => l.id === cur.current.channel) ?? -1;
  const duration = slot ? (slot.end - slot.start) / 1000 : 0;
  const shift = slot ? slot.start + pos * 1000 - now() : 0;
  const isLive = Math.abs(shift) < LIVE_WITHIN;
  const pct = (seconds: number) => `${duration ? (Math.max(0, Math.min(duration, seconds)) / duration) * 100 : 0}%`;
  return (
    <div className={`tv ${background ? 'background' : ''}`} onMouseMove={() => showUi(1500)}>
      <div className="screen" ref={box} />
      {!started && (
        <div className="splash" onClick={start}>
          {lineups === null ? 'Loading…' : target ? (
            <>
              <span>Click or press any key to tune in to {target.name}</span>
              <small>Click pause · double-click full screen · ↑ ↓ Channel · ← → skip 5s · Shift+N/P next/previous video · K pause · M mute · C captions · G Guide · R Restart · L Go live · Esc Channels</small>
              <small>Hold right-click and scroll to change volume</small>
            </>
          ) : (
            <span>There's no Channel at /{slug}. <a href="/">See all Channels</a></span>
          )}
        </div>
      )}
      {started && <div className="click-layer" onClick={togglePause} onDoubleClick={toggleFullscreen} />}
      {flash && (
        <div key={flash.key} className="flash" onAnimationEnd={() => setFlash(null)}>
          <Icon name={flash.icon} />
        </div>
      )}
      {started && (
        <div className={`hud ${ui || paused || !slot ? '' : 'hidden'}`}>
          <div className="hud-top">
            <span className="ch">{index + 1} {lineups?.[index]?.name}</span>
            <span className="title">{slot ? slot.title : 'Off air'}</span>
            {slot && <span className="by">{slot.by}</span>}
          </div>
          {/* Clicks must not leave focus on a button, or Space and arrow keys would press it again */}
          <div
            className="hud-bottom"
            onMouseEnter={() => { overControls.current = true; }}
            onMouseLeave={() => { overControls.current = false; }}
            onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}
          >
            {slot && (
              <div
                className="progress" ref={bar}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  seekToPointer(e.clientX, false);
                }}
                onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekToPointer(e.clientX, false); }}
                onPointerUp={e => { if (e.button === 0) seekToPointer(e.clientX, true); }}
              >
                <div className="progress-live" style={{ width: pct((now() - slot.start) / 1000) }} />
                <div className="progress-played" style={{ width: pct(pos) }} />
              </div>
            )}
            <div className="controls">
              <Ctl icon="previous" label="Previous video (Shift+P)" onClick={previous} disabled={!slot} />
              <Ctl icon={paused ? 'play' : 'pause'} label={paused ? 'Play (k)' : 'Pause (k)'} onClick={togglePause} />
              <Ctl icon="next" label="Skip to next video (Shift+N)" onClick={next} disabled={!slot} />
              <Ctl icon="replay" label="Restart (r)" onClick={restart} />
              <Ctl icon="down" label="Channel down (↓)" onClick={() => flip(-1)} />
              <Ctl icon="up" label="Channel up (↑)" onClick={() => flip(1)} />
              <div className="volume">
                <Ctl icon={muted || !volume ? 'muted' : 'volume'} label={muted ? 'Unmute (m)' : 'Mute (m)'} onClick={toggleMute} />
                <input
                  type="range" min={0} max={100} value={muted ? 0 : volume} aria-label="Volume"
                  onChange={e => changeVolume(Number(e.target.value))}
                  onPointerUp={e => e.currentTarget.blur()}
                />
              </div>
              {slot && <span className="time">{clock(pos * 1000)} / {clock(duration * 1000)}</span>}
              {slot && (
                <button className={`live ${isLive ? 'at-live' : ''}`} onClick={goLive} title={isLive ? 'Watching Live' : 'Go live (l)'}>
                  <i />{isLive ? 'LIVE' : `${shift < 0 ? '−' : '+'}${clock(shift)}`}
                </button>
              )}
              <span className="spacer" />
              <Ctl icon="block" label="Exclude: never show this video on this Channel again" onClick={exclude} disabled={!slot} />
              <Ctl icon="guide" label="Guide (g)" onClick={() => setGuide(true)} />
              <Ctl icon="cc" label="Captions (c)" onClick={toggleCaptions} className={captions ? 'on' : ''} aria-pressed={captions} />
              <Ctl icon="home" label="Channels (Esc)" onClick={() => go('/')} />
              <Ctl icon={fullscreen ? 'fullscreenExit' : 'fullscreen'} label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'} onClick={toggleFullscreen} />
            </div>
          </div>
        </div>
      )}
      {guide && (
        <Guide
          channel={cur.current.channel}
          onPlay={(c, s) => { setGuide(false); tuneIn(c, s); }}
          onClose={() => setGuide(false)}
        />
      )}
    </div>
  );
}
