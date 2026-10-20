import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import Icon from './Icon.tsx';

type Comment = { id: string; author: string; avatar: string; text: string; likes: number; at: number; replies: number };
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
      const r = await api<Page | null>(path + (token.current ? `?page=${encodeURIComponent(token.current)}` : ''));
      token.current = r ? r.next : null;
      setState(s => r ? { list: [...s.list, ...r.comments] } : { list: [], off: true });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
    busy.current = false;
  }
  return { ...state, more, started: token.current !== undefined, done: token.current === null };
}

function Item({ c, children }: { c: Comment; children?: ReactNode }) {
  return (
    <li className="comment">
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

export default function Comments({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const page = usePages(`videos/${videoId}/comments`);
  useEffect(() => { page.more(); }, []); // the Player keys this by video, so it mounts once per video
  return (
    // Loads the next 20 once the viewer scrolls near the bottom
    <aside className="comments" onScroll={e => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) page.more();
    }}>
      <header>
        <b>Comments</b>
        {/* No focus left on the button, or Space would press it again instead of pausing */}
        <button onClick={onClose} onMouseDown={e => e.preventDefault()} title="Close comments" aria-label="Close comments"><Icon name="close" /></button>
      </header>
      {page.off && <p>Comments are turned off for this video.</p>}
      {page.done && !page.off && !page.list.length && <p>No comments yet.</p>}
      <ul>{page.list.map(c => <Thread key={c.id} c={c} />)}</ul>
      {page.loading && <p className="dim">Loading…</p>}
      {page.error && <p className="error">{page.error}</p>}
    </aside>
  );
}
