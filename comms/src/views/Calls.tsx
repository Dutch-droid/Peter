import { useEffect, useState } from 'react';
import { api, type CallRecord, type User } from '../api';
import { go, useStore } from '../store';
import { socket } from '../socket';
import { useCall } from '../call/CallProvider';
import { Avatar, duration, Empty, Icon, presenceOf, timeShort } from '../components/ui';

async function dmWith(userId: number) {
  const { conversation } = await api('/api/conversations/dm', { body: { userId } });
  return conversation.id as number;
}

export function CallsView() {
  const { me, user, users, conversations, conversationName, toast } = useStore();
  const { startCall } = useCall();
  const [history, setHistory] = useState<CallRecord[] | null>(null);
  const [q, setQ] = useState('');
  const load = () => void api<{ calls: CallRecord[] }>('/api/calls').then((r) => setHistory(r.calls));
  useEffect(load, []);
  useEffect(() => socket.on((e) => e.type === 'call:ended' && setTimeout(load, 300)), []);

  const call = async (u: User, media: 'audio' | 'video') => {
    try {
      await startCall(await dmWith(u.id), media);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const lq = q.toLowerCase();
  const people = [...users.values()]
    .filter((u) => u.id !== me.id && (!lq || u.name.toLowerCase().includes(lq) || u.email.includes(lq)))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    .slice(0, 50);

  return (
    <div className="calls-view">
      <section className="panel">
        <div className="list-head">
          <h1>Make a call</h1>
        </div>
        <div className="list-search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people to call" />
        </div>
        <ul className="dial-list">
          {people.map((u) => (
            <li key={u.id}>
              <Avatar user={u} size={36} />
              <span className="grow">
                <strong>{u.name}</strong>
                <small>{presenceOf(u).label}{u.title ? ` · ${u.title}` : ''}</small>
              </span>
              <button className="icon-btn" onClick={() => void call(u, 'audio')} aria-label={`Voice call ${u.name}`} title="Voice call">
                <Icon name="phone" />
              </button>
              <button className="icon-btn" onClick={() => void call(u, 'video')} aria-label={`Video call ${u.name}`} title="Video call">
                <Icon name="video" />
              </button>
            </li>
          ))}
          {!people.length && <li className="hint pad">No one found.</li>}
        </ul>
      </section>
      <section className="panel">
        <div className="list-head">
          <h1>Recent calls</h1>
        </div>
        <ul className="history">
          {history === null && <li className="hint pad">Loading…</li>}
          {history?.length === 0 && <li><Empty icon="phone" title="No calls yet">Call anyone from the list, or from any chat.</Empty></li>}
          {history?.map((h) => {
            const conv = conversations.find((c) => c.id === h.conversationId);
            const other = h.conversationType === 'dm' ? user(h.participantIds.concat(conv?.memberIds ?? []).find((id) => id !== me.id)) : undefined;
            const title = conv ? conversationName(conv) : h.conversationName || 'Group call';
            const missed = h.missedByMe || (h.status !== 'ended' && h.direction === 'incoming');
            const icon = missed ? 'missed' : h.direction === 'incoming' ? 'incoming' : 'outgoing';
            return (
              <li key={h.id} className={missed ? 'missed' : ''}>
                <Icon name={icon} size={18} className="dir-icon" />
                {other ? <Avatar user={other} size={34} /> : <span className="avatar channel-avatar" style={{ width: 34, height: 34 }}><Icon name="people" size={16} /></span>}
                <span className="grow">
                  <strong>{title}</strong>
                  <small>
                    {h.media === 'video' ? 'Video' : 'Voice'} ·{' '}
                    {h.status === 'ended' ? duration(h.durationMs) : missed ? 'Missed' : h.status === 'declined' ? 'Declined' : 'No answer'} · {timeShort(h.startedAt)}
                  </small>
                </span>
                <button className="icon-btn" onClick={() => void startCall(h.conversationId, h.media)} aria-label={`Call ${title} again`} title="Call back">
                  <Icon name={h.media === 'video' ? 'video' : 'phone'} />
                </button>
                <button className="icon-btn" onClick={() => go(`chat/${h.conversationId}`)} aria-label="Open chat" title="Open chat">
                  <Icon name="chat" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function PeopleView() {
  const { users, me, toast } = useStore();
  const { startCall } = useCall();
  const [q, setQ] = useState('');
  const lq = q.toLowerCase();
  const list = [...users.values()]
    .filter((u) => !lq || u.name.toLowerCase().includes(lq) || u.email.includes(lq) || u.title.toLowerCase().includes(lq))
    .sort((a, b) => a.name.localeCompare(b.name));
  const online = list.filter((u) => u.online).length;
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="people-view">
      <div className="list-head">
        <h1>People</h1>
        <span className="muted">{online} of {list.length} online</span>
      </div>
      <div className="list-search wide">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or title" aria-label="Search people" />
      </div>
      <ul className="people-grid">
        {list.map((u) => (
          <li key={u.id} className="person-card">
            <Avatar user={u} size={52} />
            <strong>{u.name}{u.id === me.id && ' (you)'}</strong>
            <small>{u.title || '—'}</small>
            <small className="muted">{u.email}</small>
            <span className={`presence-label p-${presenceOf(u).key}`}>{presenceOf(u).label}</span>
            {u.statusMessage && <small className="status-msg">“{u.statusMessage}”</small>}
            {u.id !== me.id && (
              <div className="row gap-xs">
                <button className="icon-btn" aria-label={`Chat with ${u.name}`} title="Chat" onClick={() => void act(async () => go(`chat/${await dmWith(u.id)}`))}>
                  <Icon name="chat" />
                </button>
                <button className="icon-btn" aria-label={`Email ${u.name}`} title="Email" onClick={() => go(`mail/compose?to=${u.id}`)}>
                  <Icon name="mail" />
                </button>
                <button className="icon-btn" aria-label={`Call ${u.name}`} title="Voice call" onClick={() => void act(async () => startCall(await dmWith(u.id), 'audio'))}>
                  <Icon name="phone" />
                </button>
                <button className="icon-btn" aria-label={`Video call ${u.name}`} title="Video call" onClick={() => void act(async () => startCall(await dmWith(u.id), 'video'))}>
                  <Icon name="video" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
