import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { api, device, go, now, schedule, setIcon, type Lineup, type Slot } from './api.ts';
import Comments, { Item, type Timed } from './Comments.tsx';
import Guide from './Guide.tsx';
import Icon, { type IconName } from './Icon.tsx';
import ChannelStats from './Stats.tsx';

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
const DRIFT_WITHIN = 30_000;
const TIMED_FOR = 8; // seconds a Timed comment stays up
const TIMED_MAX = 3; // on screen at once
const LEAD_IN = 5; // seconds a jump to a Timed comment lands before its moment
const WATCH_EVERY = 30_000; // how often a playing Screen adds to its Channel's viewing time; matches the server
const PLAY_AFTER = 30; // seconds an airing must play before it counts as a view of its video; matches the server

// What every Screen in a Room plays: `time` seconds into `slot` at `at`, moving on from there unless paused
type RoomState = { channel: number; slot: Slot | null; time: number; paused: boolean; at: number };
const roomTime = (s: RoomState) => s.paused ? s.time : s.time + (now() - s.at) / 1000;
const sameSlot = (a: Slot | null, b: Slot | null) => a?.videoId === b?.videoId && a?.start === b?.start;

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
  const played = useRef({ seconds: 0, at: Date.now(), counted: false }); // how long the current airing has played here
  const hideTimer = useRef(0);
  const overControls = useRef(false);
  const rightDown = useRef(false);
  const clickTimer = useRef(0);
  const vol = useRef(load('volume', 100));
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [started, setStarted] = useState(false);
  const [guide, setGuide] = useState(false);
  const [stats, setStats] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [uploader, setUploader] = useState<{ videoId: string; channelId: string }>();
  const [timed, setTimed] = useState<{ videoId: string; list: Timed[] }>();
  const [overlay, setOverlay] = useState(() => load('timedComments', 1) === 1);
  const [pos, setPos] = useState(0); // seconds into the current video
  const [ui, setUi] = useState(true);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [background, setBackground] = useState(document.hidden);
  const [flash, setFlash] = useState<{ icon: IconName; key: number } | null>(null);
  const [volume, setVolume] = useState(vol.current);
  const [muted, setMuted] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [volumeOsd, setVolumeOsd] = useState<{ level: number; key: number } | null>(null);
  const swallowClick = useRef(false);
  const [captions, setCaptions] = useState(() => load('captions', 0) === 1);
  const captionsOn = useRef(captions);
  captionsOn.current = captions;
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get('room'));
  const [roomInfo, setRoomInfo] = useState<{ hostOnly: boolean; members: number; host: boolean } | null>(null);
  const [roomPanel, setRoomPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomRef = useRef<{ id: string | null; state: RoomState | null; control: boolean }>({ id: room, state: null, control: true });
  const applying = useRef(false); // playing what the Room sent, which mustn't be sent back
  const advancing = useRef<Slot | null | undefined>(undefined); // the Slot this Screen just moved on from by itself
  const seeking = useRef(false);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const locked = !!roomInfo?.hostOnly && !roomInfo.host;
  const roomLink = room ? `${location.origin}${location.pathname}?room=${room}` : '';
  const target = lineups?.find(l => l.slug === slug);

  useEffect(() => {
    schedule(now(), now() + 1).then(setLineups);
    const t = setInterval(() => {
      const time = yt.current?.getCurrentTime?.();
      if (time === undefined) return;
      setPos(time);
      // Counts playing time by the clock, since background tabs run this less often
      const p = played.current, t = Date.now(), { channel, slot: on } = cur.current;
      if (yt.current.getPlayerState?.() === window.YT.PlayerState.PLAYING) p.seconds += Math.min(5, (t - p.at) / 1000);
      p.at = t;
      if (on && !p.counted && p.seconds >= PLAY_AFTER) {
        p.counted = true;
        api(`channels/${channel}/plays`, 'POST', { device, videoId: on.videoId }).catch(() => {});
      }
      if (roomRef.current.state) return syncRef.current(time);
      // Near Live, play 5% fast or slow to drift back onto it unnoticed; further off is a deliberate Time-shift and stays at normal speed
      const slot = cur.current.slot;
      const shift = slot ? slot.start + time * 1000 - now() : 0;
      const rate = Math.abs(shift) < DRIFT_WITHIN && Math.abs(shift) > 500 ? (shift < 0 ? 1.05 : 0.95) : 1;
      if (yt.current.getPlaybackRate?.() !== rate) yt.current.setPlaybackRate(rate);
    }, 500);
    const watching = setInterval(() => {
      if (cur.current.channel && yt.current?.getPlayerState?.() === window.YT.PlayerState.PLAYING)
        api(`channels/${cur.current.channel}/watch`, 'POST', { device }).catch(() => {});
    }, WATCH_EVERY);
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
      clearInterval(watching);
      clearTimeout(hideTimer.current);
      setIcon();
      removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => { if (target) start(); }, [lineups]);

  useEffect(() => {
    if (!room) return;
    const events = new EventSource(`/api/rooms/${room}/events?device=${device}`);
    events.onmessage = e => {
      const m = JSON.parse(e.data);
      roomRef.current = { id: room, state: m.state, control: !m.hostOnly || m.host };
      setRoomInfo({ hostOnly: m.hostOnly, members: m.members, host: m.host });
    };
    events.onerror = () => {
      if (events.readyState !== EventSource.CLOSED) return; // the browser reconnects by itself
      alert('This room has ended');
      leaveRoom();
    };
    return () => events.close();
  }, [room]);

  // Tells the Room what this Screen now plays; a guest without control isn't heard, and sync puts them back
  function share(time: number, paused: boolean, after = advancing.current) {
    const r = roomRef.current;
    if (!r.id || applying.current || (after === undefined && !r.control)) return;
    const { channel, slot } = cur.current;
    r.state = { channel, slot, time, paused, at: now() };
    api(`rooms/${r.id}/state`, 'POST', { device, state: r.state, after }).catch(() => {});
  }

  const isPaused = () => yt.current?.getPlayerState?.() === window.YT.PlayerState.PAUSED;

  // Keeps this Screen on the Room's Channel, Slot and moment, nudging the speed for small gaps like Live does
  function sync(time: number) {
    const s = roomRef.current.state!, p = yt.current, { channel, slot } = cur.current;
    if (s.channel !== channel || !sameSlot(s.slot, slot)) {
      applying.current = true;
      if (s.channel !== channel) show(s.channel);
      play(s.channel, s.slot, false, s.slot ? s.slot.start + roomTime(s) * 1000 : undefined);
      applying.current = false;
      return;
    }
    const want = roomTime(s), state = p.getPlayerState();
    const { PLAYING, PAUSED } = window.YT.PlayerState;
    // Still loading, being dragged, or past the end, where ENDED moves everyone on
    if (!slot || seeking.current || ![PLAYING, PAUSED].includes(state) || want * 1000 >= slot.end - slot.start) return;
    if (s.paused && state === PLAYING) p.pauseVideo();
    if (!s.paused && state === PAUSED) p.playVideo();
    const off = time - want;
    if (Math.abs(off) > (s.paused ? 0.5 : 2)) p.seekTo(want, true);
    const rate = !s.paused && Math.abs(off) > 0.3 ? (off < 0 ? 1.05 : 0.95) : 1;
    if (p.getPlaybackRate?.() !== rate) p.setPlaybackRate(rate);
  }

  async function startRoom() {
    const { channel, slot } = cur.current;
    const state = { channel, slot, time: yt.current?.getCurrentTime?.() ?? 0, paused: isPaused() };
    const r = await api<{ id: string }>('rooms', 'POST', { device, state }).catch(e => alert(e.message));
    if (!r) return;
    roomRef.current = { id: r.id, state: null, control: true };
    history.replaceState(null, '', `${location.pathname}?room=${r.id}`);
    setRoom(r.id);
    setRoomPanel(true);
    copyLink(`${location.origin}${location.pathname}?room=${r.id}`);
  }

  // Leaving keeps playing from the same moment, on this Screen only
  function leaveRoom() {
    roomRef.current = { id: null, state: null, control: true };
    history.replaceState(null, '', location.pathname);
    setRoom(null);
    setRoomInfo(null);
    setRoomPanel(false);
  }

  // The clipboard needs HTTPS (or localhost); without it the link box is there to copy from
  function copyLink(link = roomLink) {
    navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {});
  }

  function showUi(ms: number) {
    setUi(true);
    clearTimeout(hideTimer.current);
    // Stays up while the mouse rests on the controls
    hideTimer.current = window.setTimeout(() => (overControls.current ? showUi(ms) : setUi(false)), ms);
  }

  function play(channel: number, slot: Slot | null, fromStart: boolean, at = now()) {
    cur.current = { channel, slot };
    played.current = { seconds: 0, at: Date.now(), counted: false };
    setPos(0);
    showUi(4000);
    share(slot && !fromStart ? (at - slot.start) / 1000 : 0, false);
    if (!slot) {
      setIcon();
      yt.current.stopVideo();
      setTimeout(() => cur.current.channel === channel && !cur.current.slot && live(channel), 30_000); // off air: look again soon
      return;
    }
    yt.current.loadVideoById({ videoId: slot.videoId, startSeconds: fromStart ? 0 : (at - slot.start) / 1000 });
    api<{ channelId: string; avatar: string | null } | null>(`videos/${slot.videoId}/uploader`).catch(() => null).then(r => {
      if (cur.current.slot !== slot) return; // ignore answers for videos already skipped past
      setIcon(r?.avatar ?? undefined);
      if (r) setUploader({ videoId: slot.videoId, channelId: r.channelId });
    });
    api<Timed[]>(`videos/${slot.videoId}/timed-comments`).catch(() => []).then(list => {
      if (cur.current.slot === slot) setTimed({ videoId: slot.videoId, list });
    });
  }

  // Plays whatever airs at a moment: Live by default, or an earlier one for a popped-out window that was time-shifted
  async function live(channel: number, at = now()) {
    const [l] = await schedule(at, at + 1, channel);
    if (cur.current.channel === channel) play(channel, l?.slots[0] ?? null, false, at);
  }

  function show(channel: number) {
    cur.current.channel = channel;
    const l = lineups?.find(x => x.id === channel);
    if (l) {
      // each Channel has its own address
      history.replaceState(null, '', '/' + l.slug + (roomRef.current.id ? `?room=${roomRef.current.id}` : ''));
      document.title = `${l.name} · Youtube TV`;
    }
  }

  function tuneIn(channel: number, slot?: Slot, at?: number) {
    show(channel);
    api(`channels/${channel}/tune`, 'POST').catch(() => {}); // lets this Channel's New uploads get queued
    const t = now();
    // A Slot airing right now joins at the Live moment; past and upcoming ones play from their start
    return slot ? play(channel, slot, !(slot.start <= t && t < slot.end)) : live(channel, at);
  }

  // A small separate window to drag onto another screen; it picks up at this exact moment and this one pauses
  async function popOut() {
    const { channel, slot } = cur.current;
    const l = lineups?.find(x => x.id === channel);
    if (!l || window.name === POPOUT || roomRef.current.id) return;
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

  // `auto` when the video ended or failed by itself rather than someone skipping it
  async function next(auto = false) {
    const { channel, slot } = cur.current;
    if (!slot) return live(channel);
    const [l] = await schedule(slot.start, slot.end + 1, channel);
    if (cur.current.channel !== channel) return;
    const slots = l?.slots ?? [];
    const i = slots.findIndex(s => s.start === slot.start && s.videoId === slot.videoId);
    advancing.current = auto ? slot : undefined;
    // Never jump mid-video: if the Schedule changed under us, play whatever now covers this video's end, from its start
    play(channel, (i >= 0 ? slots[i + 1] : slots.find(s => s.start <= slot.end && s.end > slot.end)) ?? null, true);
    advancing.current = undefined;
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
    share(p.getCurrentTime(), playing);
    setFlash({ icon: playing ? 'pause' : 'play', key: Date.now() });
  }

  function seekBy(seconds: number) {
    const p = yt.current;
    if (!p?.getCurrentTime) return;
    const t = Math.max(0, p.getCurrentTime() + seconds);
    p.seekTo(t, true);
    share(t, isPaused());
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
    seeking.current = !final;
    if (final) share(t, isPaused());
  }

  // shortcut: loadModule/unloadModule('captions') is undocumented YouTube player API; if YouTube drops it, captions follow YouTube's own default
  // Turning captions off empties YouTube's track choice, so loading the module again shows nothing until a track is set:
  // the viewer's language if the video has it, else its first track. The list only exists once the module has loaded.
  function pickTrack() {
    const p = yt.current;
    if (p?.getOption?.('captions', 'track')?.languageCode) return;
    const list: { languageCode: string }[] = p?.getOption?.('captions', 'tracklist') ?? [];
    const track = list.find(t => navigator.language.startsWith(t.languageCode)) ?? list[0];
    if (track) p.setOption('captions', 'track', { languageCode: track.languageCode });
  }

  function applyCaptions(on: boolean) {
    try {
      if (on) {
        yt.current?.loadModule('captions');
        pickTrack();
      } else {
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

  function changeOverlay(on: boolean) {
    setOverlay(on);
    store('timedComments', on ? 1 : 0);
  }

  function jumpTo(second: number) {
    const t = Math.max(0, second - LEAD_IN);
    yt.current?.seekTo(t, true);
    share(t, isPaused());
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
    await api(`channels/${channel}/exclusions`, 'POST', { videoId: slot.videoId }).then(() => next(), e => alert(e.message));
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
          // Joining a Room plays whatever the Room plays, once it says
          if (!roomRef.current.id) tuneIn(target.id, undefined, Number(new URLSearchParams(location.search).get('at')) || undefined);
          if (!interacted) setTimeout(checkAutoplay, 2000);
        },
        onStateChange: (e: { data: number }) => {
          const { ENDED, PLAYING, PAUSED } = window.YT.PlayerState;
          if (e.data === ENDED) next(true);
          if (e.data === PLAYING || e.data === PAUSED) setPaused(e.data === PAUSED);
          // YouTube brings captions back on its own (new video, resuming from pause), so re-apply the choice whenever playback starts
          if (e.data === PLAYING) applyCaptions(captionsOn.current);
        },
        // Fires when the captions module loads: unload it again if the viewer turned captions off, else pick a track
        onApiChange: () => {
          if (!yt.current.getOptions?.().includes('captions')) return;
          if (captionsOn.current) try { pickTrack(); } catch { /* not ready yet */ }
          else applyCaptions(false);
        },
        onError: (e: { data: number }) => {
          const s = cur.current.slot;
          if (s && UNPLAYABLE.includes(e.data)) api(`videos/${s.videoId}/broken`, 'POST').catch(() => {});
          next(true);
        },
      },
    });
  }

  // Watching the whole video again counts as another view
  function restart() {
    yt.current?.seekTo(0, true);
    played.current = { seconds: 0, at: Date.now(), counted: false };
    share(0, isPaused());
  }
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
      if (stats) return; // the panel closes itself on Esc
      if (locked && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'N', 'P', ' ', 'k', 'r', 'l'].includes(e.key)) return;
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
  const timedList = slot && timed?.videoId === slot.videoId ? timed.list : undefined;
  const popping = overlay && timedList ? timedList.filter(m => m.second <= pos && pos < m.second + TIMED_FOR).slice(-TIMED_MAX) : [];
  const pct = (seconds: number) => `${duration ? (Math.max(0, Math.min(duration, seconds)) / duration) * 100 : 0}%`;
  return (
    <div className={`tv ${background ? 'background' : ''}`} onMouseMove={() => showUi(1500)}>
      <div className="screen" ref={box} />
      {!started && (lineups === null || !target) && (
        <div className="splash">
          {lineups === null ? 'Loading…' : <span>There's no Channel at /{slug}. <a href="/">See all Channels</a></span>}
        </div>
      )}
      {started && (
        <div
          className="click-layer"
          // A single click waits briefly so a double-click only toggles full screen, without pausing and resuming
          onClick={e => {
            clearTimeout(clickTimer.current);
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            if (e.detail === 1 && !locked) clickTimer.current = window.setTimeout(togglePause, 300);
          }}
          onDoubleClick={toggleFullscreen}
        />
      )}
      {flash && (
        <div key={flash.key} className="flash" onAnimationEnd={() => setFlash(null)}>
          <Icon name={flash.icon} />
        </div>
      )}
      {started && (
        <div className={`hud ${ui || paused || !slot ? '' : 'hidden'}`}>
          <div className="hud-top">
            <span className="ch">{index + 1} {lineups?.[index]?.name}</span>
            {/* Opens the video on YouTube at this second, pausing here so the two don't play over each other */}
            {slot ? (
              <a className="title" href={`https://www.youtube.com/watch?v=${slot.videoId}&t=${Math.floor(pos)}s`}
                target="_blank" rel="noreferrer" onClick={() => yt.current?.pauseVideo()}>{slot.title}</a>
            ) : <span className="title">Off air</span>}
            {/* Becomes a link once the uploader lookup answers for this video */}
            {slot && (
              <a className="by" href={uploader?.videoId === slot.videoId ? `https://www.youtube.com/channel/${uploader.channelId}` : undefined}
                target="_blank" rel="noreferrer">{slot.by}</a>
            )}
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
                className={`progress ${locked ? 'locked' : ''}`} ref={bar}
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
              <Ctl icon="previous" label="Previous video (Shift+P)" onClick={previous} disabled={!slot || locked} />
              <Ctl icon={paused ? 'play' : 'pause'} label={paused ? 'Play (k)' : 'Pause (k)'} onClick={togglePause} disabled={locked} />
              <Ctl icon="next" label="Skip to next video (Shift+N)" onClick={() => next()} disabled={!slot || locked} />
              <Ctl icon="replay" label="Restart (r)" onClick={restart} disabled={locked} />
              <Ctl icon="down" label="Channel down (↓)" onClick={() => flip(-1)} disabled={locked} />
              <Ctl icon="up" label="Channel up (↑)" onClick={() => flip(1)} disabled={locked} />
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
                <button className={`live ${isLive ? 'at-live' : ''}`} onClick={goLive} disabled={locked} title={isLive ? 'Watching Live' : 'Go live (l)'}>
                  <i />{isLive ? 'LIVE' : `${shift < 0 ? '−' : '+'}${clock(shift)}`}
                </button>
              )}
              <span className="spacer" />
              <Ctl icon="block" label="Exclude: never show this video on this Channel again" onClick={exclude} disabled={!slot || locked} />
              <Ctl icon="guide" label="Guide (g)" onClick={() => setGuide(true)} />
              <Ctl icon="stats" label="Stats" onClick={() => setStats(true)} />
              <Ctl icon="comments" label="Comments" onClick={() => setShowComments(s => !s)} className={showComments ? 'on' : ''} aria-pressed={showComments} disabled={!slot} />
              <Ctl icon="cc" label="Captions (c)" onClick={toggleCaptions} className={captions ? 'on' : ''} aria-pressed={captions} />
              <Ctl icon="room" label={room ? 'Room' : 'Start a room to watch together'} className={room ? 'on' : ''}
                onClick={() => (room ? setRoomPanel(p => !p) : startRoom())} />
              <Ctl icon="home" label="Channels (Esc)" onClick={() => go('/')} />
              {/* Popping out pauses this window, which in a Room would pause everyone */}
              {window.name !== POPOUT && !room && <Ctl icon="popout" label="Pop out into a small window that stays on top (i)" onClick={popOut} />}
              <Ctl icon={fullscreen ? 'fullscreenExit' : 'fullscreen'} label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'} onClick={toggleFullscreen} />
            </div>
          </div>
        </div>
      )}
      {popping.length > 0 && (
        <ul className="timed">
          {popping.map(m => (
            <Item key={`${m.comment.id}@${m.second}`} c={m.comment} className="comment jump" title="Jump to this moment" onClick={() => jumpTo(m.second)}>
              <button className="hide-timed" onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); changeOverlay(false); }}
                title="Keep Timed comments in the Comments panel only">Hide popups</button>
            </Item>
          ))}
        </ul>
      )}
      {/* keyed by video, so each new video starts the panel over at its own first page */}
      {showComments && slot && (
        <Comments key={slot.videoId} videoId={slot.videoId} timed={timedList} overlay={overlay} onOverlay={changeOverlay}
          onJump={jumpTo} onClose={() => setShowComments(false)} />
      )}
      {volumeOsd && (
        <div key={volumeOsd.key} className="volume-osd" onAnimationEnd={() => setVolumeOsd(null)}>{volumeOsd.level}</div>
      )}
      {needsUnmute && (
        <button className="unmute" onClick={unmute}>
          <Icon name="muted" /> Click to unmute
        </button>
      )}
      {roomPanel && room && (
        <div className="room-panel">
          <div className="room-head">
            <b>Room · {roomInfo?.members ?? 1} watching</b>
            <button title="Close" aria-label="Close" onClick={() => setRoomPanel(false)}><Icon name="close" /></button>
          </div>
          <div className="room-link">
            <input readOnly value={roomLink} aria-label="Room link" onFocus={e => e.target.select()} />
            {navigator.clipboard && <button onClick={() => copyLink()}>{copied ? 'Copied' : 'Copy link'}</button>}
          </div>
          {roomInfo?.host ? (
            <label>
              <input type="checkbox" checked={roomInfo.hostOnly}
                onChange={e => api(`rooms/${room}`, 'PUT', { device, hostOnly: e.target.checked }).catch(err => alert(err.message))} />
              Only I control playback
            </label>
          ) : <small>{roomInfo?.hostOnly ? 'Only the host controls playback' : 'Everyone controls playback'}</small>}
          <button onClick={leaveRoom}>Leave room</button>
        </div>
      )}
      {stats && lineups?.[index] &&<ChannelStats key={lineups[index].id} channel={lineups[index]} onClose={() => setStats(false)} />}
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
