import { useEffect, useRef, useState } from 'react';
import { api, now, schedule, type Lineup, type Slot } from './api.ts';
import Guide from './Guide.tsx';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void }
}

const ytReady = new Promise<void>(resolve => {
  window.onYouTubeIframeAPIReady = resolve;
  document.head.append(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api' }));
});

const UNPLAYABLE = [100, 101, 150]; // removed, private, or embedding disabled
const LIVE_WITHIN = 15_000;

function clock(ms: number) {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Player() {
  const box = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null);
  const cur = useRef<{ channel: number; slot: Slot | null }>({ channel: 0, slot: null });
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [started, setStarted] = useState(false);
  const [guide, setGuide] = useState(false);
  const [shift, setShift] = useState(0);
  const [uiUntil, setUiUntil] = useState(0);

  useEffect(() => {
    schedule(now(), now() + 1).then(setLineups);
    // Time-shift is derived, never stored: where this Screen is in the Schedule minus where Live is
    const t = setInterval(() => {
      const s = cur.current.slot;
      const time = yt.current?.getCurrentTime?.();
      if (s && time !== undefined) setShift(s.start + time * 1000 - now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  function play(channel: number, slot: Slot | null, fromStart: boolean) {
    cur.current = { channel, slot };
    setUiUntil(Date.now() + 5000);
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

  async function start() {
    if (started || !lineups?.length) return;
    setStarted(true);
    await ytReady;
    yt.current = new window.YT.Player(box.current!.appendChild(document.createElement('div')), {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3 },
      events: {
        onReady: () => tuneIn(lineups[0].id),
        onStateChange: (e: { data: number }) => e.data === window.YT.PlayerState.ENDED && next(),
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
        case ' ': if (p?.getPlayerState() === 1) p.pauseVideo(); else p?.playVideo(); break;
        case 'f': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); break;
        default: return;
      }
      e.preventDefault();
      setUiUntil(Date.now() + 4000);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const slot = cur.current.slot;
  const index = lineups?.findIndex(l => l.id === cur.current.channel) ?? -1;
  const isLive = Math.abs(shift) < LIVE_WITHIN;
  return (
    <div className="tv" onMouseMove={() => setUiUntil(Date.now() + 3000)}>
      <div className="screen" ref={box} />
      {!started && (
        <div className="splash" onClick={start}>
          {lineups === null ? 'Loading…' : lineups.length ? (
            <>
              <span>Click or press any key to tune in</span>
              <small>↑ ↓ change Channel · G Guide · R Restart · L Go live · Space pause · F fullscreen</small>
            </>
          ) : (
            <span>No Channels yet. <a href="#/settings">Add one in Settings</a></span>
          )}
        </div>
      )}
      {started && (
        <div className={`hud ${Date.now() < uiUntil || !slot ? '' : 'hidden'}`}>
          <div className="now-playing">
            <span className="ch">{index + 1} {lineups?.[index]?.name}</span>
            <span>{slot ? `${slot.title} · ${slot.by}` : 'Off air'}</span>
            {slot && <span className={`shift ${isLive ? 'live' : ''}`}>{isLive ? 'LIVE' : `${shift < 0 ? '−' : '+'}${clock(shift)}`}</span>}
          </div>
          <nav>
            <button onClick={() => flip(-1)}>▼ Ch</button>
            <button onClick={() => flip(1)}>▲ Ch</button>
            <button onClick={restart}>Restart</button>
            <button onClick={goLive} disabled={isLive}>Go live</button>
            <button onClick={() => setGuide(true)}>Guide</button>
            <a href="#/settings">Settings</a>
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
