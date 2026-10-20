import { useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react';
import { api, go, now, schedule, setIcon, type Lineup, type Slot } from './api.ts';
import { app } from './app.ts';
import Comments from './Comments.tsx';
import Guide from './Guide.tsx';
import Icon, { type IconName } from './Icon.tsx';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    documentPictureInPicture?: { requestWindow(size: { width: number; height: number }): Promise<Window> }; // Chrome and Edge only
  }
}

const ytReady = new Promise<void>(resolve => {
  window.onYouTubeIframeAPIReady = resolve;
  document.head.append(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api' }));
});

// Browsers can block sound until the page gets a click or key press, so a Channel page opened directly may start muted
let interacted = false;
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { interacted = true; }, { once: true, capture: true });

const UNPLAYABLE = [100, 101, 150]; // removed, private, or embedding disabled
const POPOUT = 'youtube-tv-popout'; // one shared window name, so popping out again reuses the same small window
const LIVE_WITHIN = 15_000;
const DOUBLE_TAP = 300;
const SWIPE = 50; // px a finger travels up or down the video to change Channel
const landscapeQuery = matchMedia('(orientation: landscape)');

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
  const clickTimer = useRef(0);
  const lastTap = useRef(0);
  const swipe = useRef<{ x: number; y: number; done?: boolean } | null>(null);
  const vol = useRef(load('volume', 100));
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [started, setStarted] = useState(false);
  const [guide, setGuide] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [pos, setPos] = useState(0); // seconds into the current video
  const [ui, setUi] = useState(true);
  const uiShown = useRef(ui);
  uiShown.current = ui;
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [landscape, setLandscape] = useState(landscapeQuery.matches);
  const [pip, setPip] = useState(false);
  const [background, setBackground] = useState(document.hidden);
  const [flash, setFlash] = useState<{ icon: IconName; key: number; side?: 'left' | 'right' } | null>(null);
  const [volume, setVolume] = useState(vol.current);
  const [muted, setMuted] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [volumeOsd, setVolumeOsd] = useState<{ level: number; key: number } | null>(null);
  const swallowClick = useRef(false);
  const [captions, setCaptions] = useState(() => load('captions', 0) === 1);
  const captionsOn = useRef(captions);
  captionsOn.current = captions;
  const target = lineups?.find(l => l.slug === slug);
  // In the Android app, like YouTube's: holding the phone sideways is full screen, and the full screen button turns it
  const full = app ? landscape : fullscreen;

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
    const onTurn = () => setLandscape(landscapeQuery.matches);
    const onPip = (e: Event) => setPip((e as CustomEvent<boolean>).detail);
    addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('visibilitychange', onVisibility);
    landscapeQuery.addEventListener('change', onTurn);
    addEventListener('app-pip', onPip);
    return () => {
      clearInterval(t);
      clearTimeout(hideTimer.current);
      setIcon();
      removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisibility);
      landscapeQuery.removeEventListener('change', onTurn);
      removeEventListener('app-pip', onPip);
      app?.setPlaying(false);
      app?.setImmersive(false);
    };
  }, []);

  useEffect(() => {
    app?.setImmersive(full);
    if (app) for (const ms of [300, 1000]) setTimeout(() => applyCaptions(captionsOn.current), ms); // as for fullscreenchange above
  }, [full]);

  useEffect(() => { if (target) start(); }, [lineups]);

  function showUi(ms: number) {
    setUi(true);
    clearTimeout(hideTimer.current);
    // Stays up while the mouse rests on the controls
    hideTimer.current = window.setTimeout(() => (overControls.current ? showUi(ms) : setUi(false)), ms);
  }

  function play(channel: number, slot: Slot | null, fromStart: boolean, at = now()) {
    cur.current = { channel, slot };
    setPos(0);
    showUi(4000);
    if (!slot) {
      setIcon();
      app?.setPlaying(false);
      yt.current.stopVideo();
      setTimeout(() => cur.current.channel === channel && !cur.current.slot && live(channel), 30_000); // off air: look again soon
      return;
    }
    yt.current.loadVideoById({ videoId: slot.videoId, startSeconds: fromStart ? 0 : (at - slot.start) / 1000 });
    api<{ url: string | null }>(`videos/${slot.videoId}/avatar`).catch(() => null)
      .then(r => { if (cur.current.slot === slot) setIcon(r?.url ?? undefined); }); // ignore answers for videos already skipped past
  }

  // Plays whatever airs at a moment: Live by default, or an earlier one for a popped-out window that was time-shifted
  async function live(channel: number, at = now()) {
    const [l] = await schedule(at, at + 1, channel);
    if (cur.current.channel === channel) play(channel, l?.slots[0] ?? null, false, at);
  }

  function tuneIn(channel: number, slot?: Slot, at?: number) {
    cur.current.channel = channel;
    const l = lineups?.find(x => x.id === channel);
    if (l) {
      history.replaceState(null, '', '/' + l.slug); // each Channel has its own address
      document.title = `${l.name} · Youtube TV`;
    }
    api(`channels/${channel}/tune`, 'POST').catch(() => {}); // lets this Channel's New uploads get queued
    return slot ? play(channel, slot, true) : live(channel, at);
  }

  // A small separate window to drag onto another screen; it picks up at this exact moment and this one pauses
  async function popOut() {
    if (app) return app.enterPip(); // Android's own picture-in-picture: this page shrinks into a small window over other apps
    const { channel, slot } = cur.current;
    const l = lineups?.find(x => x.id === channel);
    if (!l || window.name === POPOUT) return;
    const at = slot && Math.round(slot.start + (yt.current?.getCurrentTime?.() ?? 0) * 1000);
    const url = `/${l.slug}${at ? `?at=${at}` : ''}`;
    // A picture-in-picture window stays on top of everything (Chrome, Edge); other browsers get an ordinary small window
    const pip = await window.documentPictureInPicture?.requestWindow({ width: 640, height: 360 }).catch(() => null);
    if (pip) {
      pip.document.body.style.cssText = 'margin: 0; background: #000';
      pip.document.body.append(Object.assign(pip.document.createElement('iframe'), {
        src: url, name: POPOUT, allow: 'autoplay; fullscreen', style: 'position: fixed; inset: 0; width: 100%; height: 100%; border: 0',
      }));
    } else if (!window.open(url, POPOUT, 'popup,width=640,height=360')) return;
    yt.current?.pauseVideo();
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

  const toggleFull = () => (app ? app.rotate(!full) : toggleFullscreen());

  // Phone taps work like YouTube's app: one tap shows or hides the controls, double-tapping either side skips 10s back or forward
  function tap(e: ReactMouseEvent<HTMLDivElement>) {
    clearTimeout(clickTimer.current);
    const x = e.clientX / e.currentTarget.clientWidth;
    const side = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : undefined;
    const double = e.timeStamp - lastTap.current < DOUBLE_TAP;
    lastTap.current = e.timeStamp;
    if (double && side) {
      seekBy(side === 'left' ? -10 : 10);
      setFlash({ icon: side === 'left' ? 'rewind' : 'forward', key: Date.now(), side });
      return;
    }
    clickTimer.current = window.setTimeout(() => (uiShown.current ? setUi(false) : showUi(3000)), DOUBLE_TAP);
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
    setVolumeOsd({ level, key: Date.now() });
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

  // Like YouTube: if the browser blocked sound on a direct visit, play muted and unmute on the first click or key press
  function checkAutoplay() {
    const p = yt.current;
    const { PLAYING, BUFFERING } = window.YT.PlayerState;
    if (interacted || !p || [PLAYING, BUFFERING].includes(p.getPlayerState())) return;
    p.mute();
    setMuted(true);
    setNeedsUnmute(true);
    p.playVideo();
  }

  function unmute() {
    yt.current?.unMute();
    setMuted(false);
    setNeedsUnmute(false);
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
          tuneIn(target.id, undefined, Number(new URLSearchParams(location.search).get('at')) || undefined);
          if (!interacted) setTimeout(checkAutoplay, 2000);
        },
        onStateChange: (e: { data: number }) => {
          const { ENDED, PLAYING, PAUSED } = window.YT.PlayerState;
          if (e.data === ENDED) next();
          if (e.data === PLAYING || e.data === PAUSED) {
            setPaused(e.data === PAUSED);
            app?.setPlaying(e.data === PLAYING); // keeps the screen on, and leaving the app goes to picture-in-picture
          }
          // YouTube brings captions back on its own (new video, resuming from pause), so re-apply the choice whenever playback starts
          if (e.data === PLAYING) applyCaptions(captionsOn.current);
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
      if (!started) return;
      if (needsUnmute) {
        unmute();
        if (e.key === 'm') return;
      }
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
        case 'f': toggleFull(); break;
        case 'i': popOut(); break;
        case 'Escape': go('/'); break;
        default: return;
      }
      e.preventDefault();
      showUi(2500);
    };
    const onDown = (e: MouseEvent) => {
      if (e.button === 2) rightDown.current = true;
      if (needsUnmute) {
        unmute();
        swallowClick.current = !!(e.target as Element).closest?.('.click-layer'); // the unmuting click shouldn't also pause
      }
    };
    const onUp = (e: MouseEvent) => { if (e.button === 2) rightDown.current = false; };
    const onBlur = () => { rightDown.current = false; };
    // Hold right-click and scroll to change volume
    const onWheel = (e: WheelEvent) => {
      if (!started || !rightDown.current) return;
      e.preventDefault();
      changeVolume(vol.current - Math.sign(e.deltaY));
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    // The Android app's picture-in-picture buttons, and 'pause' when the app is left
    const onCommand = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (name === 'pause') yt.current?.pauseVideo();
      if (name === 'togglePause') togglePause();
      if (name === 'next') next();
      if (name === 'previous') previous();
    };
    // The Android app's back button closes what's open, then leaves full screen, then goes back to Channels
    const onBack = (e: Event) => {
      e.preventDefault();
      if (guide) setGuide(false);
      else if (showComments) setShowComments(false);
      else if (full) toggleFull();
      else go('/');
    };
    addEventListener('keydown', onKey);
    addEventListener('app-command', onCommand);
    addEventListener('app-back', onBack);
    addEventListener('mousedown', onDown);
    addEventListener('mouseup', onUp);
    addEventListener('blur', onBlur);
    addEventListener('wheel', onWheel, { passive: false });
    addEventListener('contextmenu', noMenu);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('app-command', onCommand);
      removeEventListener('app-back', onBack);
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
  const liveButton = slot && (
    <button className={`live ${isLive ? 'at-live' : ''}`} onClick={goLive} title={isLive ? 'Watching Live' : 'Go live (l)'}>
      <i />{isLive ? 'LIVE' : `${shift < 0 ? '−' : '+'}${clock(shift)}`}
    </button>
  );
  const progress = slot && (
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
  );
  const info = (
    <>
      <span className="ch">{index + 1} {lineups?.[index]?.name}</span>
      <span className="title">{slot ? slot.title : 'Off air'}</span>
      {slot && <span className="by">{slot.by}</span>}
    </>
  );
  const fullButton = <Ctl icon={full ? 'fullscreenExit' : 'fullscreen'} label={full ? 'Exit full screen (f)' : 'Full screen (f)'} onClick={toggleFull} />;
  const comments = showComments && slot && <Comments key={slot.videoId} videoId={slot.videoId} onClose={() => setShowComments(false)} />;
  // On a phone held upright the video sits on top with its details underneath, like YouTube's app
  const below = app && !full;
  return (
    <div
      className={`tv ${background ? 'background' : ''} ${app ? 'phone' : ''} ${full ? 'full' : ''} ${pip ? 'pip' : ''}`}
      // Taps also send mouse events; the phone controls show and hide on taps alone
      onMouseMove={app ? undefined : () => showUi(1500)}
    >
      <div className="stage">
        <div className="screen" ref={box} />
        {!started && (lineups === null || !target) && (
          <div className="splash">
            {lineups === null ? 'Loading…' : <span>There's no Channel at /{slug}. <a href="/">See all Channels</a></span>}
          </div>
        )}
        {started && (
          <div
            className="click-layer"
            onClick={e => {
              clearTimeout(clickTimer.current);
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              if (app) return swipe.current?.done || tap(e);
              // A single click waits briefly so a double-click only toggles full screen, without pausing and resuming
              if (e.detail === 1) clickTimer.current = window.setTimeout(togglePause, 300);
            }}
            onDoubleClick={app ? undefined : toggleFull}
            // Swiping up or down the video changes Channel, like flicking through a TV app
            onPointerDown={app && (e => { swipe.current = { x: e.clientX, y: e.clientY }; })}
            onPointerUp={app && (e => {
              const s = swipe.current;
              if (!s) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (Math.abs(dy) < SWIPE || Math.abs(dy) < 2 * Math.abs(dx)) return;
              s.done = true;
              clearTimeout(clickTimer.current);
              flip(dy < 0 ? 1 : -1);
            })}
          />
        )}
        {flash && (
          <div key={flash.key} className={`flash ${flash.side ?? ''}`} onAnimationEnd={() => setFlash(null)}>
            <Icon name={flash.icon} />
          </div>
        )}
        {started && !app && (
          <div className={`hud ${ui || paused || !slot ? '' : 'hidden'}`}>
            <div className="hud-top">{info}</div>
            {/* Clicks must not leave focus on a button, or Space and arrow keys would press it again */}
            <div
              className="hud-bottom"
              onMouseEnter={() => { overControls.current = true; }}
              onMouseLeave={() => { overControls.current = false; }}
              onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}
            >
              {progress}
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
                {liveButton}
                <span className="spacer" />
                <Ctl icon="block" label="Exclude: never show this video on this Channel again" onClick={exclude} disabled={!slot} />
                <Ctl icon="guide" label="Guide (g)" onClick={() => setGuide(true)} />
                <Ctl icon="comments" label="Comments" onClick={() => setShowComments(s => !s)} className={showComments ? 'on' : ''} aria-pressed={showComments} disabled={!slot} />
                <Ctl icon="cc" label="Captions (c)" onClick={toggleCaptions} className={captions ? 'on' : ''} aria-pressed={captions} />
                <Ctl icon="home" label="Channels (Esc)" onClick={() => go('/')} />
                {window.name !== POPOUT && <Ctl icon="popout" label="Pop out into a small window that stays on top (i)" onClick={popOut} />}
                {fullButton}
              </div>
            </div>
          </div>
        )}
        {/* Phone controls modelled on YouTube's app: tapping a button keeps them up a little longer */}
        {started && app && (
          <div className={`hud ${ui || paused || !slot ? '' : 'hidden'}`} onClickCapture={() => showUi(3000)}>
            <div className="hud-top">
              <div className="info">{full && info}</div>
              <div className="controls">
                <Ctl icon={muted ? 'muted' : 'volume'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
                <Ctl icon="cc" label="Captions" onClick={toggleCaptions} className={captions ? 'on' : ''} aria-pressed={captions} />
                <Ctl icon="popout" label="Picture-in-picture" onClick={popOut} />
              </div>
            </div>
            <div className="middle">
              <Ctl icon="previous" label="Previous video" onClick={previous} disabled={!slot} />
              <Ctl icon={paused ? 'play' : 'pause'} label={paused ? 'Play' : 'Pause'} onClick={togglePause} className="big" />
              <Ctl icon="next" label="Skip to next video" onClick={next} disabled={!slot} />
            </div>
            <div className="hud-bottom">
              <div className="controls">
                {slot && <span className="time">{clock(pos * 1000)} / {clock(duration * 1000)}</span>}
                {liveButton}
                <span className="spacer" />
                {full && (
                  <>
                    <Ctl icon="replay" label="Restart" onClick={restart} />
                    <Ctl icon="block" label="Exclude: never show this video on this Channel again" onClick={exclude} disabled={!slot} />
                    <Ctl icon="guide" label="Guide" onClick={() => setGuide(true)} />
                    <Ctl icon="comments" label="Comments" onClick={() => setShowComments(s => !s)} className={showComments ? 'on' : ''} aria-pressed={showComments} disabled={!slot} />
                    <Ctl icon="home" label="Channels" onClick={() => go('/')} />
                  </>
                )}
                <Ctl icon="down" label="Channel down" onClick={() => flip(-1)} />
                <Ctl icon="up" label="Channel up" onClick={() => flip(1)} />
                {fullButton}
              </div>
              {progress}
            </div>
          </div>
        )}
        {/* keyed by video, so each new video starts the panel over at its own first page */}
        {!below && comments}
        {volumeOsd && (
          <div key={volumeOsd.key} className="volume-osd" onAnimationEnd={() => setVolumeOsd(null)}>{volumeOsd.level}</div>
        )}
        {needsUnmute && (
          <button className="unmute" onClick={unmute}>
            <Icon name="muted" /> {app ? 'Tap' : 'Click'} to unmute
          </button>
        )}
      </div>
      {below && started && (
        <div className="below">
          <div className="details">{info}</div>
          <div className="chips">
            <button onClick={() => setGuide(true)}><Icon name="guide" /> Guide</button>
            <button onClick={() => setShowComments(s => !s)} className={showComments ? 'on' : ''} aria-pressed={showComments} disabled={!slot}>
              <Icon name="comments" /> Comments
            </button>
            <button onClick={restart}><Icon name="replay" /> Restart</button>
            <button onClick={exclude} disabled={!slot}><Icon name="block" /> Exclude</button>
            <button onClick={() => go('/')}><Icon name="home" /> Channels</button>
          </div>
          {comments}
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
