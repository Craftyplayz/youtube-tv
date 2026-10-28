import { useEffect, useRef, useState, type LiHTMLAttributes, type ReactNode } from 'react';
import { api } from './api.ts';
import Icon from './Icon.tsx';

export type Comment = { id: string; author: string; avatar: string; text: string; likes: number; at: number; replies: number };
type Page = { comments: Comment[]; next: string | null };

const compact = new Intl.NumberFormat('en', { notation: 'compact' });
const relative = new Intl.RelativeTimeFormat('en');
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000], ['month', 30 * 86_400_000], ['week', 7 * 86_400_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
];
// "3 days ago", like YouTube
function ago(at: number) {
  const ms = Date.now() - at;
  const [unit, size] = UNITS.find(([, size]) => ms >= size) ?? [];
  return unit ? relative.format(-Math.floor(ms / size!), unit) : 'just now';
}

// Pages through comments; more() fetches the next page and does nothing while one is on its way or after the last
function usePages(path: string) {
  const [state, setState] = useState<{ list: Comment[]; off?: boolean; loading?: boolean; error?: string }>({ list: [] });
  const token = useRef<string | null>(undefined); // undefined before the first page, null after the last; a ref so a burst of scroll events can't fetch one page twice
  const busy = useRef(false);
  async function more() {
    if (busy.current || token.current === null) return;
    busy.current = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      const r = await api<Page | null>(path + (token.current ? `${path.includes('?') ? '&' : '?'}page=${encodeURIComponent(token.current)}` : ''));
      token.current = r ? r.next : null;
      setState(s => r ? { list: [...s.list, ...r.comments] } : { list: [], off: true });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
    busy.current = false;
  }
  return { ...state, more, started: token.current !== undefined, done: token.current === null };
}

export function Item({ c, children, ...li }: { c: Comment; children?: ReactNode } & LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li className="comment" {...li}>
      <img src={c.avatar} alt="" referrerPolicy="no-referrer" />
      <div>
        <div><b>{c.author}</b> <small>{ago(c.at)}</small></div>
        <p>{c.text}</p>
        <small className="likes"><Icon name="like" />{c.likes > 0 && compact.format(c.likes)}</small>
        {children}
      </div>
    </li>
  );
}

function Thread({ c }: { c: Comment }) {
  const [open, setOpen] = useState(false);
  const replies = usePages(`comments/${c.id}/replies`);
  if (!c.replies) return <Item c={c} />;
  return (
    <Item c={c}>
      <button className="replies-toggle" aria-expanded={open} onClick={() => {
        setOpen(!open);
        if (!replies.started) replies.more();
      }}>
        {open ? '▴' : '▾'} {c.replies} {c.replies === 1 ? 'reply' : 'replies'}
      </button>
      {open && (
        <>
          <ul>{replies.list.map(r => <Item key={r.id} c={r} />)}</ul>
          {replies.loading && <p className="dim">Loading…</p>}
          {replies.error && <p className="error">{replies.error}</p>}
          {replies.started && !replies.done && !replies.loading && (
            <button className="replies-toggle" onClick={replies.more}>↳ Show more replies</button>
          )}
        </>
      )}
    </Item>
  );
}

export type Timed = { second: number; comment: Comment };

const TABS = [['relevance', 'Top'], ['time', 'Newest'], ['timed', 'Timed']] as const;

type Props = {
  videoId: string;
  timed?: Timed[]; // undefined while loading
  overlay: boolean; // Timed comments pop up over the video
  onOverlay: (on: boolean) => void;
  onClose: () => void;
};

export default function Comments({ videoId, timed, overlay, onOverlay, onClose }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('relevance');
  const header = (
    // No focus left on the buttons, or Space would press them again instead of pausing
    <header>
      <b>Comments</b>
      <span className="sort">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-pressed={tab === t} onClick={() => setTab(t)} onMouseDown={e => e.preventDefault()}>{label}</button>
        ))}
      </span>
      <button onClick={onClose} onMouseDown={e => e.preventDefault()} title="Close comments" aria-label="Close comments"><Icon name="close" /></button>
    </header>
  );
  if (tab === 'timed') return (
    <aside className="comments">
      {header}
      <label className="overlay-toggle">
        {/* Blurred after each change, or Space would tick it again instead of pausing */}
        <input type="checkbox" checked={overlay} onChange={e => { onOverlay(e.target.checked); e.currentTarget.blur(); }} />
        Pop up over the video
      </label>
      {!timed && <p className="dim">Loading…</p>}
      {timed && !timed.length && <p>No top comments point at a moment in this video.</p>}
      <ul>{timed?.map(m => <Item key={`${m.comment.id}@${m.second}`} c={m.comment} />)}</ul>
    </aside>
  );
  // Keyed by sort, so switching starts the list over at the top
  return <Feed key={tab} path={`videos/${videoId}/comments?order=${tab}`}>{header}</Feed>;
}

function Feed({ path, children }: { path: string; children: ReactNode }) {
  const page = usePages(path);
  useEffect(() => { page.more(); }, []); // keyed by video and sort, so it mounts once per list
  return (
    // Loads the next 20 once the viewer scrolls near the bottom
    <aside className="comments" onScroll={e => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) page.more();
    }}>
      {children}
      {page.off && <p>Comments are turned off for this video.</p>}
      {page.done && !page.off && !page.list.length && <p>No comments yet.</p>}
      <ul>{page.list.map(c => <Thread key={c.id} c={c} />)}</ul>
      {page.loading && <p className="dim">Loading…</p>}
      {page.error && <p className="error">{page.error}</p>}
    </aside>
  );
}
