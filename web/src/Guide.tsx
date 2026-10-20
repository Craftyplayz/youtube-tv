import { useEffect, useRef, useState } from 'react';
import { now, schedule, thumb, type Lineup, type Slot } from './api.ts';

const HOUR = 3_600_000;
const STEP = HOUR / 2; // time labels
const BACK = 24 * HOUR; // catch-up window
const AHEAD = 6 * HOUR;
const PX_PER_MIN = 8;
const NAME_W = 200;
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = { channel: number; onPlay: (channel: number, slot: Slot) => void; onClose: () => void };

// Every Channel's Schedule, a day back and a few hours ahead; any Slot plays from its start
export default function Guide({ channel, onPlay, onClose }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [{ at, from, to }] = useState(() => {
    const at = now();
    return { at, from: Math.floor(at / STEP) * STEP - BACK, to: Math.ceil((at + AHEAD) / STEP) * STEP };
  });
  const x = (t: number) => NAME_W + ((Math.min(Math.max(t, from), to) - from) / 60_000) * PX_PER_MIN;
  const width = x(to);

  useEffect(() => { schedule(from, to).then(setLineups); }, [from, to]);
  useEffect(() => {
    const g = grid.current;
    if (!lineups || !g) return;
    g.querySelector('.guide-row.current')?.scrollIntoView({ block: 'center' });
    g.scrollLeft = x(at) - NAME_W - 120;
  }, [lineups]);

  return (
    <div className="guide" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="guide-grid" ref={grid}>
        <div className="guide-row guide-times" style={{ width }}>
          <div className="guide-name">Guide <small>Esc closes · Shift + scroll moves through time</small></div>
          {Array.from({ length: (to - from) / STEP }, (_, i) => from + i * STEP).map(t => <span key={t} style={{ left: x(t) }}>{time(t)}</span>)}
          <i className="now-line" style={{ left: x(at) }} />
        </div>
        {lineups === null && <p className="guide-loading">Loading…</p>}
        {lineups?.map((l, i) => (
          <div key={l.id} className={`guide-row ${l.id === channel ? 'current' : ''}`} style={{ width }}>
            <div className="guide-name"><span className="guide-number">{i + 1}</span>{l.name}</div>
            {l.slots.map(s => (
              <button
                key={s.start}
                className={s.end <= at ? 'past' : s.start <= at ? 'on' : ''}
                style={{ left: x(s.start), width: x(s.end) - x(s.start) }}
                title={`${time(s.start)} ${s.title} · ${s.by}`}
                onClick={() => onPlay(l.id, s)}
              >
                <img src={thumb(s.videoId)} alt="" loading="lazy" />
                <b>{s.title}</b>
                <small>{time(s.start)} · {s.by}</small>
              </button>
            ))}
            {!l.slots.length && <span className="off-air">Off air</span>}
            <i className="now-line" style={{ left: x(at) }} />
          </div>
        ))}
      </div>
    </div>
  );
}
