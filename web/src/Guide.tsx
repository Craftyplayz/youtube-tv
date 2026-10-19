import { useEffect, useRef, useState } from 'react';
import { now, schedule, type Lineup, type Slot } from './api.ts';

const HOUR = 3_600_000;
const PX_PER_MIN = 5;
const NAME_W = 180;
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = { channel: number; onPlay: (channel: number, slot: Slot) => void; onClose: () => void };

// Every Channel's Schedule, a day back and a day ahead; any Slot plays from its start
export default function Guide({ channel, onPlay, onClose }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [{ at, from, to }] = useState(() => {
    const at = now();
    const from = Math.floor(at / HOUR) * HOUR - 24 * HOUR;
    return { at, from, to: from + 49 * HOUR };
  });
  const x = (t: number) => NAME_W + ((Math.min(Math.max(t, from), to) - from) / 60_000) * PX_PER_MIN;

  useEffect(() => { schedule(from, to).then(setLineups); }, [from, to]);
  useEffect(() => { if (lineups && grid.current) grid.current.scrollLeft = x(at) - NAME_W - 60; }, [lineups]);

  return (
    <div className="guide" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="guide-grid" ref={grid}>
        <div className="guide-row guide-times" style={{ width: x(to) }}>
          <div className="guide-name">Guide <small>Esc closes</small></div>
          {Array.from({ length: 49 }, (_, i) => from + i * HOUR).map(h => <span key={h} style={{ left: x(h) }}>{time(h)}</span>)}
        </div>
        {lineups === null && <p className="guide-loading">Loading…</p>}
        {lineups?.map((l, i) => (
          <div key={l.id} className={`guide-row ${l.id === channel ? 'current' : ''}`} style={{ width: x(to) }}>
            <div className="guide-name">{i + 1} {l.name}</div>
            {l.slots.map(s => (
              <button
                key={s.start}
                className={s.end <= at ? 'past' : s.start <= at ? 'on' : ''}
                style={{ left: x(s.start), width: x(s.end) - x(s.start) }}
                title={`${time(s.start)} ${s.title} · ${s.by}`}
                onClick={() => onPlay(l.id, s)}
              >
                <b>{s.title}</b>
                <small>{time(s.start)} · {s.by}</small>
              </button>
            ))}
            {!l.slots.length && <span className="off-air">Off air</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
