import { useEffect, useRef, useState } from 'react';
import { api, go, now, schedule, type Lineup, type Slot } from './api.ts';
import Guide from './Guide.tsx';

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
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

export default function Player({ slug }: { slug: string }) {
  const box = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null);
  const startedRef = useRef(false);
  const cur = useRef<{ channel: number; slot: Slot | null }>({ channel: 0, slot: null });
  const hideTimer = useRef(0);
  const overHud = useRef(false);
  const rightDown = useRef(false);
  const captionsFor = useRef('');
  const vol = useRef(load('volume', 100));
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [started, setStarted] = useState(false);
  const [guide, setGuide] = useState(false);
  const [shift, setShift] = useState(0);
  const [ui, setUi] = useState(true);
  const [volume, setVolume] = useState(vol.current);
  const [captions, setCaptions] = useState(() => load('captions', 0) === 1);
  const captionsOn = useRef(captions);
  captionsOn.current = captions;
  const target = lineups?.find(l => l.slug === slug);

  useEffect(() => { if (target && interacted) start(); }, [lineups]);

  useEffect(() => {
    schedule(now(), now() + 1).then(setLineups);
    // Time-shift is derived, never stored: where this Screen is in the Schedule minus where Live is
    const t = setInterval(() => {
      const s = cur.current.slot;
      const time = yt.current?.getCurrentTime?.();
      if (s && time !== undefined) setShift(s.start + time * 1000 - now());
    }, 1000);
    return () => {
      clearInterval(t);
      clearTimeout(hideTimer.current);
    };
  }, []);

  function showUi(ms: number) {
    setUi(true);
    clearTimeout(hideTimer.current);
    // Stays up while the mouse rests on the controls
    hideTimer.current = window.setTimeout(() => (overHud.current ? showUi(ms) : setUi(false)), ms);
  }

  function play(channel: number, slot: Slot | null, fromStart: boolean) {
    cur.current = { channel, slot };
    captionsFor.current = '';
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

  function flip(step: number) {
    if (!lineups?.length) return;
    const i = lineups.findIndex(l => l.id === cur.current.channel);
    tuneIn(lineups[(i + step + lineups.length) % lineups.length].id);
  }

  // shortcut: loadModule/unloadModule('captions') is undocumented YouTube player API; if YouTube drops it, captions follow YouTube's own default
  function applyCaptions(on: boolean) {
    try {
      if (on) yt.current?.loadModule('captions');
      else yt.current?.unloadModule('captions');
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
    if (level > 0) yt.current?.unMute();
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
          const { ENDED, PLAYING } = window.YT.PlayerState;
          if (e.data === ENDED) next();
          // Captions reset with every new video, so re-apply the choice once each one starts
          const id = cur.current.slot?.videoId ?? '';
          if (e.data === PLAYING && captionsFor.current !== id) {
            captionsFor.current = id;
            applyCaptions(captionsOn.current);
          }
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
      const p = yt.current;
      switch (e.key) {
        case 'ArrowUp': flip(1); break;
        case 'ArrowDown': flip(-1); break;
        case 'g': setGuide(true); break;
        case 'r': restart(); break;
        case 'l': goLive(); break;
        case 'c': toggleCaptions(); break;
        case ' ': if (p?.getPlayerState() === 1) p.pauseVideo(); else p?.playVideo(); break;
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
  const isLive = Math.abs(shift) < LIVE_WITHIN;
  return (
    <div className="tv" onMouseMove={() => showUi(1500)}>
      <div className="screen" ref={box} />
      {!started && (
        <div className="splash" onClick={start}>
          {lineups === null ? 'Loading…' : target ? (
            <>
              <span>Click or press any key to tune in to {target.name}</span>
              <small>↑ ↓ change Channel · G Guide · R Restart · L Go live · C captions · Space pause · F fullscreen · Esc Channels</small>
              <small>Hold right-click and scroll to change volume</small>
            </>
          ) : (
            <span>There's no Channel at /{slug}. <a href="/">See all Channels</a></span>
          )}
        </div>
      )}
      {started && (
        <div
          className={`hud ${ui || !slot ? '' : 'hidden'}`}
          onMouseEnter={() => { overHud.current = true; }}
          onMouseLeave={() => { overHud.current = false; }}
        >
          <div className="now-playing">
            <span className="ch">{index + 1} {lineups?.[index]?.name}</span>
            <span>{slot ? `${slot.title} · ${slot.by}` : 'Off air'}</span>
            {slot && <span className={`shift ${isLive ? 'live' : ''}`}>{isLive ? 'LIVE' : `${shift < 0 ? '−' : '+'}${clock(shift)}`}</span>}
          </div>
          {/* Clicks must not leave focus on a button, or Space and arrow keys would press it again */}
          <nav onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}>
            <button onClick={() => flip(-1)}>▼ Ch</button>
            <button onClick={() => flip(1)}>▲ Ch</button>
            <button onClick={restart}>Restart</button>
            <button onClick={goLive} disabled={isLive}>Go live</button>
            <button onClick={() => setGuide(true)}>Guide</button>
            <button onClick={toggleCaptions} className={captions ? 'on' : ''} aria-pressed={captions} title="Captions (C)">CC</button>
            <label className="volume" title="Volume (or hold right-click and scroll)">
              <span aria-hidden>{volume ? '🔊' : '🔇'}</span>
              <input
                type="range" min={0} max={100} value={volume} aria-label="Volume"
                onChange={e => changeVolume(Number(e.target.value))}
                onPointerUp={e => e.currentTarget.blur()}
              />
            </label>
            <button onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Fullscreen">⛶</button>
            <button onClick={exclude} disabled={!slot} title="Never show this video on this Channel again">Exclude</button>
            <a href="/">Channels</a>
          </nav>
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
