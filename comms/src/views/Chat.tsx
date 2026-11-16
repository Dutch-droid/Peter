import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, upload, type Attachment, type ConnectedApp, type Conversation, type Message, type User } from '../api';
import { go, useStore } from '../store';
import { socket } from '../socket';
import { useCall } from '../call/CallProvider';
import { useIsPhone } from '../useMedia';
import {
  Avatar, bytes, ErrorState, clock, dayLabel, duration, Empty, fullDate, GroupAvatar, Icon, Modal, PeoplePicker, presenceOf, REACTION_LABEL, RichText, timeShort,
} from '../components/ui';

export function ConvAvatar({ c, size = 36 }: { c: Conversation; size?: number }) {
  const { me, user } = useStore();
  if (c.type === 'channel')
    return (
      <span className="avatar channel-avatar" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
        <Icon name="hash" size={size * 0.5} />
      </span>
    );
  const others = c.memberIds.filter((id) => id !== me.id);
  if (c.type === 'dm') return <Avatar user={user(others[0])} size={size} />;
  return <GroupAvatar ids={others} size={size} />;
}

function previewText(c: Conversation, meId: number) {
  const lm = c.lastMessage;
  if (!lm) return c.topic || 'No messages yet';
  if (lm.kind === 'call' || lm.kind === 'system') return lm.preview;
  if (lm.kind === 'app') return `${lm.senderName}: ${lm.preview}`;
  if (lm.senderId === meId) return `You: ${lm.preview}`;
  if (c.type !== 'dm' && lm.senderName) return `${lm.senderName.split(' ')[0]}: ${lm.preview}`;
  return lm.preview;
}

// ---------------- desktop sidebar sections ----------------

export function SidebarConversations() {
  const { conversations, conversationName, route, user, me } = useStore();
  const [modal, setModal] = useState<'new' | 'channels' | null>(null);
  const channels = conversations.filter((c) => c.type === 'channel').sort((a, b) => a.name.localeCompare(b.name));
  const direct = conversations.filter((c) => c.type !== 'channel');
  const activeId = route.view === 'chat' ? route.id : undefined;
  return (
    <>
      <div className="side-section">
        <div className="side-heading">
          <span>Channels</span>
          <button className="side-add" onClick={() => setModal('channels')} aria-label="Browse or create channels" title="Browse or create channels">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <ul>
          {channels.map((c) => (
            <li key={c.id}>
              <a href={`#/chat/${c.id}`} className={`side-row ${c.id === activeId ? 'active' : ''} ${c.unread && !c.muted ? 'unread' : ''}`} aria-current={c.id === activeId ? 'page' : undefined}>
                <Icon name="hash" size={16} className="side-hash" />
                <span className="side-name">{c.name}</span>
                {c.mentions > 0 && <Icon name="at" size={14} className="side-at" title="You were mentioned" />}
                {c.muted ? <Icon name="bellOff" size={14} className="side-muted" title="Muted" /> : c.unread > 0 && <span className="badge">{c.unread > 99 ? '99+' : c.unread}</span>}
              </a>
            </li>
          ))}
          {!channels.length && <li className="side-empty">No channels yet</li>}
        </ul>
      </div>
      <div className="side-section">
        <div className="side-heading">
          <span>Direct messages</span>
          <button className="side-add" onClick={() => setModal('new')} aria-label="New message" title="New message">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <ul>
          {direct.map((c) => {
            const other = c.type === 'dm' ? user(c.memberIds.find((x) => x !== me.id)) : undefined;
            const p = presenceOf(other);
            return (
              <li key={c.id}>
                <a href={`#/chat/${c.id}`} className={`side-row ${c.id === activeId ? 'active' : ''} ${c.unread && !c.muted ? 'unread' : ''}`} aria-current={c.id === activeId ? 'page' : undefined}>
                  <ConvAvatar c={c} size={24} />
                  <span className="side-name">
                    {conversationName(c)}
                    {other && <span className="side-status">{p.label}</span>}
                  </span>
                  {c.muted ? <Icon name="bellOff" size={14} className="side-muted" /> : c.unread > 0 && <span className="badge">{c.unread > 99 ? '99+' : c.unread}</span>}
                </a>
              </li>
            );
          })}
          {!direct.length && <li className="side-empty">Start a conversation with the + button</li>}
        </ul>
      </div>
      {modal === 'new' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'channels' && <ChannelsModal onClose={() => setModal(null)} />}
    </>
  );
}

// ---------------- chat view ----------------

export function ChatView() {
  const { route, conversations } = useStore();
  const phone = useIsPhone();
  const activeId = route.id;
  useEffect(() => {
    if (!phone && !activeId && conversations.length) {
      const general = conversations.find((c) => c.type === 'channel' && c.name === 'general') ?? conversations[0];
      go(`chat/${general.id}`);
    }
  }, [phone, activeId, conversations]);
  if (phone && !activeId) return <MobileChatList />;
  if (!activeId)
    return (
      <div className="chat-empty">
        <Empty icon="chat" title="No conversations yet">Create a channel or message someone from the sidebar.</Empty>
      </div>
    );
  return <ChatPane key={activeId} id={activeId} />;
}

type Filter = 'all' | 'channels' | 'direct' | 'mentions';

function MobileChatList() {
  const { conversations, conversationName, me, typing, activeCalls } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [modal, setModal] = useState<'new' | 'channels' | null>(null);
  const list = conversations
    .filter((c) =>
      filter === 'all' ? true : filter === 'channels' ? c.type === 'channel' : filter === 'direct' ? c.type !== 'channel' : !!c.mentionedAt,
    )
    .sort((a, b) => (filter === 'mentions' ? (b.mentionedAt ?? 0) - (a.mentionedAt ?? 0) : b.lastMessageAt - a.lastMessageAt));
  const pills: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'channels', label: 'Channels' },
    { key: 'direct', label: 'Direct' },
    { key: 'mentions', label: 'Mentions' },
  ];
  const mentionCount = conversations.reduce((s, c) => s + c.mentions, 0);
  return (
    <div className="m-list">
      <div className="pills" role="tablist" aria-label="Filter conversations">
        {pills.map((p) => (
          <button key={p.key} role="tab" aria-selected={filter === p.key} className={`pill-btn ${filter === p.key ? 'on' : ''}`} onClick={() => setFilter(p.key)}>
            {p.label}
            {p.key === 'mentions' && mentionCount > 0 && <span className="badge">{mentionCount}</span>}
          </button>
        ))}
      </div>
      <ul className="m-convs">
        {list.map((c) => {
          const typers = Object.keys(typing[c.id] ?? {}).length;
          const live = activeCalls.get(c.id);
          return (
            <li key={c.id}>
              <a href={`#/chat/${c.id}`} className={`m-conv ${c.unread && !c.muted ? 'unread' : ''}`}>
                <ConvAvatar c={c} size={44} />
                <span className="m-conv-main">
                  <span className="m-conv-top">
                    <span className="m-conv-name">{conversationName(c)}</span>
                    <span className="m-conv-time">{c.lastMessage ? timeShort(c.lastMessage.createdAt) : ''}</span>
                  </span>
                  <span className="m-conv-bottom">
                    <span className={`m-conv-preview ${typers || live ? 'live' : ''}`}>{live ? 'Call in progress' : typers ? 'typing…' : previewText(c, me.id)}</span>
                    {c.mentions > 0 && <Icon name="at" size={15} className="side-at" title="You were mentioned" />}
                    {c.unread > 0 && !c.muted && <span className="badge">{c.unread > 99 ? '99+' : c.unread}</span>}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
        {!list.length && (
          <li>
            <Empty icon={filter === 'mentions' ? 'at' : 'chat'} title={filter === 'mentions' ? 'No mentions yet' : 'Nothing here yet'}>
              {filter === 'mentions' ? 'When someone writes @your-name, it shows up here.' : 'Start a conversation with the button below.'}
            </Empty>
          </li>
        )}
      </ul>
      <div className="m-actions">
        <button className="btn" onClick={() => setModal('channels')}><Icon name="hash" size={18} /> Channels</button>
        <button className="btn primary" onClick={() => setModal('new')}><Icon name="plus" size={18} /> New chat</button>
      </div>
      {modal === 'new' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'channels' && <ChannelsModal onClose={() => setModal(null)} />}
    </div>
  );
}

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const { upsertConversation, toast } = useStore();
  const [ids, setIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ids.length) return;
    setBusy(true);
    try {
      const { conversation } =
        ids.length === 1
          ? await api('/api/conversations/dm', { body: { userId: ids[0] } })
          : await api('/api/conversations', { body: { type: 'group', name, memberIds: ids } });
      upsertConversation(conversation);
      go(`chat/${conversation.id}`);
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New message" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>To</span>
          <PeoplePicker value={ids} onChange={setIds} label="People" />
        </label>
        {ids.length > 1 && (
          <label className="field">
            <span>Group name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Incident bridge" />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ids.length || busy}>{ids.length > 1 ? 'Create group' : 'Start chat'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ChannelsModal({ onClose }: { onClose: () => void }) {
  const { upsertConversation, toast } = useStore();
  const [channels, setChannels] = useState<Conversation[] | null>(null);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  useEffect(() => {
    api<{ channels: Conversation[] }>('/api/channels').then((r) => setChannels(r.channels));
  }, []);
  const join = async (c: Conversation) => {
    try {
      const { conversation } = await api(`/api/conversations/${c.id}/join`, { method: 'POST' });
      upsertConversation(conversation);
      go(`chat/${c.id}`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { conversation } = await api('/api/conversations', { body: { type: 'channel', name, topic } });
      upsertConversation(conversation);
      go(`chat/${conversation.id}`);
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Modal title="Channels" onClose={onClose}>
      <form onSubmit={create} className="stack-sm create-channel">
        <h4>Create a channel</h4>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="channel-name" aria-label="Channel name" maxLength={40} required />
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Description (optional)" aria-label="Description" maxLength={250} />
        <button className="btn primary">Create channel</button>
      </form>
      <h4>All channels</h4>
      <ul className="channel-list">
        {channels === null && <li className="hint">Loading…</li>}
        {channels?.map((c) => (
          <li key={c.id}>
            <span>
              <strong># {c.name}</strong>
              <small>{c.topic || 'No description'} · {c.memberIds.length} members</small>
            </span>
            {c.joined ? (
              <button className="btn ghost" onClick={() => (go(`chat/${c.id}`), onClose())}>Open</button>
            ) : (
              <button className="btn" onClick={() => void join(c)}>Join</button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ChatPane({ id }: { id: number }) {
  const { me, user, conversations, conversationName, upsertConversation, toast, typing, activeCalls, config } = useStore();
  const callApi = useCall();
  const phone = useIsPhone();
  const [conv, setConv] = useState<Conversation | null>(conversations.find((c) => c.id === id) ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [panel, setPanel] = useState(() => !phone && window.innerWidth >= 1180);
  const listRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);

  const fromStore = conversations.find((c) => c.id === id);
  useEffect(() => {
    if (fromStore) setConv(fromStore);
  }, [fromStore]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([api(`/api/conversations/${id}`), api(`/api/conversations/${id}/messages`)])
      .then(([c, m]) => {
        if (!alive) return;
        setConv(c.conversation);
        setMessages(m.messages);
        setHasMore(m.hasMore);
        stickBottom.current = true;
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const markRead = useCallback(
    (msgId?: number) => {
      if (!conv?.joined || document.visibilityState !== 'visible') return;
      void api(`/api/conversations/${id}/read`, { body: { messageId: msgId } }).catch(() => {});
      const c = conversations.find((x) => x.id === id);
      if (c?.unread || c?.mentions) upsertConversation({ ...c, unread: 0, mentions: 0 });
    },
    [id, conv?.joined, conversations, upsertConversation],
  );

  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (lastId) markRead(lastId);
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const vis = () => document.visibilityState === 'visible' && lastId && markRead(lastId);
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [lastId, markRead]);

  useEffect(
    () =>
      socket.on((e) => {
        if (e.type === 'message:new' && e.message.conversationId === id) {
          const el = listRef.current;
          stickBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120 || e.message.senderId === me.id;
          setMessages((l) => (l.some((m) => m.id === e.message.id) ? l : [...l, e.message]));
        } else if (e.type === 'message:updated' && e.message.conversationId === id) {
          setMessages((l) => l.map((m) => (m.id === e.message.id ? e.message : m)));
        } else if (e.type === 'conversation:read' && e.conversationId === id) {
          setConv((c) => (c ? { ...c, reads: { ...c.reads, [e.userId]: e.lastReadId } } : c));
        } else if (e.type === 'hello') {
          api(`/api/conversations/${id}/messages`).then((m) => {
            setMessages((cur) => {
              const known = new Map(cur.map((x) => [x.id, x]));
              for (const x of m.messages) known.set(x.id, x);
              return [...known.values()].sort((a, b) => a.id - b.id);
            });
          });
        }
      }),
    [id, me.id],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const loadOlder = async () => {
    if (!messages.length) return;
    const el = listRef.current;
    prevHeight.current = el ? el.scrollHeight - el.scrollTop : null;
    const m = await api(`/api/conversations/${id}/messages?before=${messages[0].id}`);
    setMessages((l) => [...m.messages, ...l]);
    setHasMore(m.hasMore);
  };

  const jumpTo = (msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    } else toast('That message is further back. Load older messages to see it.');
  };

  if (error)
    return (
      <div className="chat-empty">
        <ErrorState title="Can’t open this chat" error={error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  if (!conv) return <div className="chat-empty"><div className="hint pad">Loading…</div></div>;

  const name = conversationName(conv);
  const others = conv.memberIds.filter((x) => x !== me.id);
  const dmUser = conv.type === 'dm' ? user(others[0]) : undefined;
  const live = activeCalls.get(conv.id);
  const inThisCall = callApi.call?.conversationId === conv.id;
  const typers = Object.keys(typing[conv.id] ?? {}).map(Number).filter((u) => u !== me.id);
  const otherRead = dmUser ? (conv.reads[dmUser.id] ?? 0) : 0;
  const lastSeenMine = dmUser ? [...messages].reverse().find((m) => m.senderId === me.id && m.id <= otherRead)?.id : undefined;
  const description = dmUser
    ? [presenceOf(dmUser).label, dmUser.statusMessage, dmUser.title].filter(Boolean).join(' · ')
    : conv.topic || (conv.type === 'channel' ? 'No description yet' : `${conv.memberIds.length} people`);

  return (
    <div className={`chat-layout ${panel ? 'with-panel' : ''}`}>
      <section className="chat-pane" aria-label={name}>
        <header className="chat-head">
          <a href="#/chat" className="icon-btn back-btn" aria-label="Back to chats"><Icon name="back" size={20} /></a>
          <div className="chat-title">
            <h1>{conv.type === 'channel' ? <><span className="hash">#</span>{conv.name}</> : name}</h1>
            <p>{description}</p>
          </div>
          {conv.joined && (
            <div className="row gap-xs">
              <button className="btn head-btn" onClick={() => void callApi.startCall(conv.id, 'audio')} title={conv.type === 'dm' ? 'Voice call' : 'Start a voice meeting'}>
                <Icon name="phone" size={18} /> <span className="hide-sm">Start a call</span>
              </button>
              <button className="icon-btn bordered" onClick={() => void callApi.startCall(conv.id, 'video')} aria-label="Start a video call" title="Video call">
                <Icon name="video" size={18} />
              </button>
              {dmUser && (
                <button className="icon-btn bordered hide-sm" onClick={() => go(`mail/compose?to=${dmUser.id}`)} aria-label={`Email ${dmUser.name}`} title="Email">
                  <Icon name="mail" size={18} />
                </button>
              )}
            </div>
          )}
          <button className={`btn head-btn ${panel ? 'on' : ''}`} onClick={() => setPanel((p) => !p)} aria-pressed={panel} aria-label={`Members (${conv.memberIds.length})`}>
            <Icon name="people" size={18} /> <span className="hide-sm">Members</span> <span className="count-chip">{conv.memberIds.length}</span>
          </button>
        </header>
        {live && !inThisCall && (
          <div className="live-banner">
            <span className="pulse" />
            <span>{live.media === 'video' ? 'Video' : 'Voice'} call in progress · {live.participants.map((p) => p.user.name.split(' ')[0]).join(', ')}</span>
            <button className="btn accept" onClick={() => void callApi.joinCall(live.id, live.media)}>Join call</button>
          </div>
        )}
        <div className="messages" ref={listRef}>
          {hasMore && <button className="btn ghost load-older" onClick={() => void loadOlder()}>Load older messages</button>}
          {loading && <div className="hint pad">Loading…</div>}
          {!loading && messages.length === 0 && <Empty icon="chat" title={`This is the start of ${name}`}>Send the first message below.</Empty>}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = !newDay && prev && prev.senderId === m.senderId && prev.kind === 'text' && m.kind === 'text' && m.createdAt - prev.createdAt < 5 * 60_000;
            return (
              <div key={m.id} id={`msg-${m.id}`} className="msg-wrap">
                {newDay && <div className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>}
                <MessageRow m={m} conv={conv} grouped={!!grouped} reactions={config.reactions} onReply={() => setReplyTo(m)} onEdit={() => setEditing(m)} seen={m.id === lastSeenMine} />
              </div>
            );
          })}
        </div>
        <div className="typing-line" aria-live="polite">
          {typers.length > 0 && `${typers.map((u) => user(u)?.name.split(' ')[0]).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`}
        </div>
        {conv.joined ? (
          <Composer
            conv={conv}
            replyTo={replyTo}
            clearReply={() => setReplyTo(null)}
            editing={editing}
            clearEdit={() => setEditing(null)}
            maxUpload={config.maxUploadBytes}
            onError={(t) => toast(t, 'error')}
            placeholder={`Message ${conv.type === 'channel' ? '#' + conv.name : name}`}
          />
        ) : (
          <div className="join-bar">
            <span>You’re previewing <strong>#{conv.name}</strong>.</span>
            <button
              className="btn primary"
              onClick={async () => {
                const { conversation } = await api(`/api/conversations/${conv.id}/join`, { method: 'POST' });
                upsertConversation(conversation);
                setConv(conversation);
              }}
            >
              Join channel
            </button>
          </div>
        )}
      </section>
      {panel && <SidePanel conv={conv} onClose={() => setPanel(false)} onJump={jumpTo} />}
    </div>
  );
}

function MessageRow({ m, conv, grouped, reactions, onReply, onEdit, seen }: {
  m: Message;
  conv: Conversation;
  grouped: boolean;
  reactions: string[];
  onReply: () => void;
  onEdit: () => void;
  seen: boolean;
}) {
  const { me, user, toast } = useStore();
  const [picker, setPicker] = useState(false);
  const canAct = conv.joined;
  if (m.kind === 'system') return <div className="sys-msg">{m.body} · {clock(m.createdAt)}</div>;
  const sender = user(m.senderId);
  const mine = m.senderId === me.id;

  if (m.kind === 'call' && m.meta) {
    const ok = m.meta.status === 'ended';
    const label = ok
      ? `${m.meta.media === 'video' ? 'Video' : 'Voice'} call · ${duration(m.meta.durationMs ?? 0)}`
      : m.meta.status === 'declined'
        ? 'Call declined'
        : mine
          ? 'No answer'
          : `Missed ${m.meta.media === 'video' ? 'video' : 'voice'} call from ${sender?.name ?? 'someone'}`;
    return (
      <div className={`call-msg ${ok ? '' : 'missed'}`}>
        <Icon name={ok ? (m.meta.media === 'video' ? 'video' : 'phone') : 'missed'} size={16} />
        <span>{label}</span>
        <time>{clock(m.createdAt)}</time>
      </div>
    );
  }

  const act = (p: Promise<unknown>) => void p.catch((err) => toast(err.message, 'error'));
  const react = (key: string) => {
    setPicker(false);
    act(api(`/api/messages/${m.id}/reactions`, { body: { emoji: key } }));
  };
  const del = () => confirm('Delete this message for everyone?') && act(api(`/api/messages/${m.id}`, { method: 'DELETE' }));
  const pin = () => act(api(`/api/messages/${m.id}/pin`, { body: { pinned: !m.pinned } }));
  const isApp = m.kind === 'app';
  const displayName = isApp ? (m.meta?.appName ?? 'App') : (sender?.name ?? 'Former member');

  return (
    <div className={`msg ${grouped ? 'grouped' : ''} ${m.pinned ? 'is-pinned' : ''}`}>
      <div className="msg-gutter">
        {!grouped ? (
          isApp ? <span className="avatar app-avatar" style={{ width: 36, height: 36, borderRadius: 10 }}><Icon name="app" size={18} /></span> : <Avatar user={sender} size={36} showPresence={false} />
        ) : (
          <time className="msg-hover-time">{clock(m.createdAt)}</time>
        )}
      </div>
      <div className="msg-content">
        {!grouped && (
          <div className="msg-meta">
            <strong>{displayName}</strong>
            {isApp && <span className="app-tag">App</span>}
            <time title={fullDate(m.createdAt)}>{clock(m.createdAt)}</time>
            {m.pinned && <span className="pinned-tag"><Icon name="pin" size={12} /> Pinned</span>}
          </div>
        )}
        {m.replyTo && (
          <div className="msg-quote"><strong>{m.replyTo.senderName}</strong> {m.replyTo.body}</div>
        )}
        {m.deleted ? (
          <p className="msg-body deleted">This message was deleted</p>
        ) : m.kind === 'notice' ? (
          <NoticeCard m={m} conv={conv} />
        ) : isApp ? (
          <AppAlertCard m={m} />
        ) : (
          <>
            {m.body && (
              <p className="msg-body">
                <RichText text={m.body} me={me} />
                {m.editedAt && <span className="edited"> (edited)</span>}
              </p>
            )}
            {m.attachment && <AttachmentView a={m.attachment} />}
          </>
        )}
        {m.kind === 'notice' && m.attachment && !m.deleted && <AttachmentView a={m.attachment} />}
        {Object.keys(m.reactions).length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([key, ids]) => (
              <button
                key={key}
                className={`reaction ${ids.includes(me.id) ? 'me' : ''}`}
                onClick={() => canAct && react(key)}
                aria-pressed={ids.includes(me.id)}
                aria-label={`${REACTION_LABEL[key] ?? key}: ${ids.length}. ${ids.map((i) => user(i)?.name).join(', ')}`}
                title={ids.map((i) => user(i)?.name).join(', ')}
              >
                <span><Icon name={key} size={15} /> {ids.length}</span>
              </button>
            ))}
          </div>
        )}
        {seen && <div className="seen">Seen</div>}
      </div>
      {canAct && !m.deleted && (
        <div className="msg-actions">
          <button className="icon-btn" onClick={() => setPicker((p) => !p)} aria-label="Add reaction" aria-expanded={picker}><Icon name="smile" size={18} /></button>
          {!isApp && <button className="icon-btn" onClick={onReply} aria-label="Reply"><Icon name="reply" size={18} /></button>}
          <button className="icon-btn" onClick={pin} aria-label={m.pinned ? 'Unpin' : 'Pin to channel'}><Icon name="pin" size={18} /></button>
          {mine && <button className="icon-btn" onClick={onEdit} aria-label="Edit"><Icon name="edit" size={18} /></button>}
          {mine && <button className="icon-btn" onClick={del} aria-label="Delete"><Icon name="trash" size={18} /></button>}
          {picker && (
            <div className="react-pop" role="menu">
              {reactions.map((key) => (
                <button key={key} role="menuitem" onClick={() => react(key)} aria-label={REACTION_LABEL[key] ?? key} title={REACTION_LABEL[key] ?? key}>
                  <Icon name={key} size={20} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoticeCard({ m, conv }: { m: Message; conv: Conversation }) {
  const { me, user, toast } = useStore();
  const [showWho, setShowWho] = useState(false);
  const acked = m.acks.includes(me.id);
  const audience = conv.memberIds.filter((id) => id !== m.senderId);
  const done = m.acks.filter((id) => id !== m.senderId).length;
  const pending = audience.filter((id) => !m.acks.includes(id));
  return (
    <div className="notice-card">
      <div className="notice-label"><Icon name="megaphone" size={16} /> Notice</div>
      <p className="msg-body"><RichText text={m.body} me={me} />{m.editedAt && <span className="edited"> (edited)</span>}</p>
      <div className="notice-foot">
        <button className="link-btn" onClick={() => setShowWho((s) => !s)} aria-expanded={showWho}>
          Acknowledged by {done} of {audience.length}
        </button>
        <span className="grow" />
        {m.senderId === me.id ? null : acked ? (
          <span className="acked"><Icon name="check" size={16} /> You acknowledged</span>
        ) : (
          conv.joined && (
            <button className="btn notice-btn" onClick={() => void api(`/api/messages/${m.id}/ack`, { method: 'POST' }).catch((e) => toast(e.message, 'error'))}>
              <Icon name="check" size={16} /> Acknowledge
            </button>
          )
        )}
      </div>
      {showWho && (
        <div className="notice-who">
          <div><strong>Acknowledged</strong> {m.acks.filter((id) => id !== m.senderId).map((id) => user(id)?.name).join(', ') || 'No one yet'}</div>
          {pending.length > 0 && <div><strong>Waiting on</strong> {pending.map((id) => user(id)?.name ?? 'Someone').join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

const SEV_ICON: Record<string, string> = { info: 'info', warning: 'alert', critical: 'alert', resolved: 'agree' };
const SEV_LABEL: Record<string, string> = { info: 'Info', warning: 'Warning', critical: 'Critical', resolved: 'Resolved' };

function AppAlertCard({ m }: { m: Message }) {
  const sev = m.meta?.severity ?? 'info';
  return (
    <div className={`alert-card sev-${sev}`}>
      <div className="alert-top">
        <Icon name={SEV_ICON[sev]} size={18} />
        <span className="alert-sev">{SEV_LABEL[sev]}</span>
        <span className="alert-app">{m.meta?.appName}</span>
      </div>
      <strong className="alert-title">{m.meta?.title}</strong>
      {m.body && <p className="alert-text"><RichText text={m.body} /></p>}
      {m.meta?.link && (
        <a className="btn alert-link" href={m.meta.link} target="_blank" rel="noopener noreferrer">
          Open details <Icon name="external" size={15} />
        </a>
      )}
    </div>
  );
}

function fileKind(a: Attachment) {
  const ext = a.filename.includes('.') ? a.filename.split('.').pop()!.toUpperCase().slice(0, 5) : '';
  return ext || a.mime.split('/')[1]?.toUpperCase().slice(0, 5) || 'FILE';
}

export function AttachmentView({ a }: { a: Attachment }) {
  const isImg = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.mime);
  return (
    <div className="file-card">
      {isImg && (
        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="file-preview">
          <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" />
        </a>
      )}
      <div className="file-row">
        <span className="file-icon"><Icon name="file" size={22} /></span>
        <span className="file-meta">
          <strong title={a.filename}>{a.filename}</strong>
          <small>{fileKind(a)} · {bytes(a.size)}</small>
        </span>
        <a className="btn file-dl" href={`/api/attachments/${a.id}?download=1`} aria-label={`Download ${a.filename}`}>
          <Icon name="download" size={18} /> <span className="hide-sm">Download</span>
        </a>
      </div>
    </div>
  );
}

function Composer({ conv, replyTo, clearReply, editing, clearEdit, maxUpload, onError, placeholder }: {
  conv: Conversation;
  replyTo: Message | null;
  clearReply: () => void;
  editing: Message | null;
  clearEdit: () => void;
  maxUpload: number;
  onError: (t: string) => void;
  placeholder: string;
}) {
  const draftKey = `relay:draft:${conv.id}`;
  const { user, me } = useStore();
  const [text, setText] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState(false);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const [mention, setMention] = useState<{ q: string; start: number; hi: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      ta.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (!editing) sessionStorage.setItem(draftKey, text);
  }, [text, editing, draftKey]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [text]);

  const members = useMemo(() => conv.memberIds.map((id) => user(id)).filter((u): u is User => !!u && u.id !== me.id), [conv.memberIds, user, me.id]);
  const suggestions = mention
    ? [
        ...members.filter((u) => {
          const q = mention.q.toLowerCase();
          return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().startsWith(q);
        }),
        ...(conv.type !== 'dm' && 'everyone'.startsWith(mention.q.toLowerCase()) ? [{ id: -1, name: 'everyone', email: 'everyone@', title: 'Notify everyone here' } as User] : []),
      ].slice(0, 6)
    : [];

  const updateMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\w.-]*)$/.exec(before);
    setMention(m ? { q: m[2], start: caret - m[2].length - 1, hi: 0 } : null);
  };
  const insertMention = (u: User) => {
    if (!mention) return;
    const handle = u.id === -1 ? 'everyone' : u.email.split('@')[0];
    const caret = ta.current?.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + '@' + handle + ' ' + text.slice(caret);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + handle.length + 2;
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > maxUpload) return onError(`Files can be at most ${bytes(maxUpload)}`);
    setFile(f);
  };

  const send = async () => {
    const body = text.trim();
    if (sending || (!body && !file)) return;
    setSending(true);
    try {
      if (editing) {
        await api(`/api/messages/${editing.id}`, { method: 'PATCH', body: { body } });
        clearEdit();
      } else {
        const att = file ? await upload(file) : null;
        await api(`/api/conversations/${conv.id}/messages`, { body: { body, replyToId: replyTo?.id, attachmentId: att?.id, notice } });
        clearReply();
        setFile(null);
        setNotice(false);
      }
      setText('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSending(false);
      ta.current?.focus();
    }
  };

  return (
    <div
      className={`composer ${drag ? 'drag' : ''} ${notice ? 'as-notice' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        pick(e.dataTransfer.files[0]);
      }}
    >
      {(replyTo || editing) && (
        <div className="composer-context">
          <Icon name={editing ? 'edit' : 'reply'} size={16} />
          <span>{editing ? 'Editing message' : <>Replying to <strong>{replyTo!.kind === 'app' ? replyTo!.meta?.appName : user(replyTo!.senderId)?.name}</strong>: {replyTo!.body.slice(0, 80)}</>}</span>
          <button className="icon-btn" onClick={() => (editing ? (clearEdit(), setText('')) : clearReply())} aria-label="Cancel"><Icon name="close" size={16} /></button>
        </div>
      )}
      {notice && !editing && (
        <div className="composer-context notice-ctx">
          <Icon name="megaphone" size={16} />
          <span>Posting as a <strong>Notice</strong>: everyone gets an Acknowledge button and you can see who has read it.</span>
        </div>
      )}
      {file && (
        <div className="composer-context">
          <Icon name="file" size={16} />
          <span>{file.name} · {bytes(file.size)}</span>
          <button className="icon-btn" onClick={() => setFile(null)} aria-label="Remove attachment"><Icon name="close" size={16} /></button>
        </div>
      )}
      {mention && suggestions.length > 0 && (
        <ul className="mention-menu" role="listbox" aria-label="Mention someone">
          {suggestions.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === mention.hi}>
              <button className={i === mention.hi ? 'hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(u)}>
                {u.id === -1 ? <span className="avatar app-avatar" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon name="at" size={15} /></span> : <Avatar user={u} size={28} />}
                <span><strong>{u.id === -1 ? '@everyone' : u.name}</strong><small>{u.id === -1 ? u.title : '@' + u.email.split('@')[0]}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={notice ? 'Write the notice…' : placeholder}
        aria-label="Message"
        maxLength={8000}
        onChange={(e) => {
          setText(e.target.value);
          updateMention(e.target.value, e.target.selectionStart);
          if (Date.now() - lastTyping.current > 2500) {
            lastTyping.current = Date.now();
            socket.send({ type: 'typing', conversationId: conv.id });
          }
        }}
        onClick={(e) => updateMention(text, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        onPaste={(e) => {
          const f = [...e.clipboardData.files][0];
          if (f) {
            e.preventDefault();
            pick(f);
          }
        }}
        onKeyDown={(e) => {
          if (mention && suggestions.length) {
            if (e.key === 'ArrowDown') return (e.preventDefault(), setMention({ ...mention, hi: (mention.hi + 1) % suggestions.length }));
            if (e.key === 'ArrowUp') return (e.preventDefault(), setMention({ ...mention, hi: (mention.hi - 1 + suggestions.length) % suggestions.length }));
            if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), insertMention(suggestions[mention.hi]));
            if (e.key === 'Escape') return setMention(null);
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          } else if (e.key === 'Escape') {
            if (editing) (clearEdit(), setText(''));
            else if (replyTo) clearReply();
          }
        }}
      />
      <div className="composer-bar">
        {!editing && (
          <>
            <button className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Attach a file" title="Attach a file">
              <Icon name="clip" size={20} />
            </button>
            <input ref={fileInput} type="file" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
            {conv.type !== 'dm' && (
              <button className={`icon-btn ${notice ? 'on' : ''}`} onClick={() => setNotice((n) => !n)} aria-pressed={notice} aria-label="Post as a notice that needs acknowledging" title="Post as notice">
                <Icon name="megaphone" size={20} />
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="Mention someone"
              title="Mention someone"
              onClick={() => {
                const el = ta.current!;
                const pos = el.selectionStart;
                const pre = text.slice(0, pos);
                const add = (pre && !/\s$/.test(pre) ? ' ' : '') + '@';
                const next = pre + add + text.slice(pos);
                setText(next);
                setMention({ q: '', start: pos + add.length - 1, hi: 0 });
                requestAnimationFrame(() => (el.focus(), el.setSelectionRange(pos + add.length, pos + add.length)));
              }}
            >
              <Icon name="at" size={20} />
            </button>
          </>
        )}
        <span className="composer-hint hide-sm">Enter to send · Shift+Enter for a new line</span>
        <span className="grow" />
        <button className="btn primary send-btn" onClick={() => void send()} disabled={sending || (!text.trim() && !file)}>
          <Icon name={editing ? 'check' : 'send'} size={18} /> {editing ? 'Save' : notice ? 'Post notice' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ---------------- right panel ----------------

function SidePanel({ conv, onClose, onJump }: { conv: Conversation; onClose: () => void; onJump: (id: number) => void }) {
  const { user, me, upsertConversation, removeConversation, toast } = useStore();
  const [pins, setPins] = useState<Message[]>([]);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [adding, setAdding] = useState<number[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [connect, setConnect] = useState(false);
  const [topic, setTopic] = useState(conv.topic);

  const loadPins = useCallback(() => void api(`/api/conversations/${conv.id}/pins`).then((r) => setPins(r.messages)), [conv.id]);
  const loadApps = useCallback(() => void api(`/api/conversations/${conv.id}/apps`).then((r) => setApps(r.apps)), [conv.id]);
  useEffect(() => {
    loadPins();
    if (conv.type !== 'dm') loadApps();
  }, [loadPins, loadApps, conv.type]);
  useEffect(
    () =>
      socket.on((e) => {
        if (e.type === 'pins:changed' && e.conversationId === conv.id) loadPins();
        if (e.type === 'apps:changed' && e.conversationId === conv.id) loadApps();
        if (e.type === 'message:updated' && e.message.conversationId === conv.id) setPins((p) => p.map((x) => (x.id === e.message.id ? e.message : x)));
      }),
    [conv.id, loadPins, loadApps],
  );

  const members = useMemo(
    () =>
      conv.memberIds
        .map((id) => user(id))
        .filter((u): u is User => !!u)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    [conv.memberIds, user],
  );
  const run = async (fn: () => Promise<any>) => {
    try {
      const r = await fn();
      if (r?.conversation) upsertConversation(r.conversation);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const online = members.filter((u) => u.online).length;

  return (
    <aside className="side-panel" aria-label="Channel details">
      <div className="panel-head">
        <h2>Details</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" size={18} /></button>
      </div>

      <section className="panel-section">
        <h3><Icon name="pin" size={16} /> Pinned</h3>
        {pins.length === 0 ? (
          <p className="panel-hint">Nothing pinned yet. Pin key messages, such as the incident status or a dial-in, from a message’s menu.</p>
        ) : (
          <ul className="pin-list">
            {pins.map((p) => (
              <li key={p.id}>
                <button className="pin-item" onClick={() => onJump(p.id)}>
                  <strong>{p.kind === 'app' ? p.meta?.appName : (user(p.senderId)?.name ?? 'Someone')}</strong>
                  <span>{p.kind === 'app' ? p.meta?.title : p.body || p.attachment?.filename || 'Attachment'}</span>
                  <small>{timeShort(p.createdAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h3><Icon name="people" size={16} /> In this {conv.type === 'channel' ? 'channel' : 'chat'} <span className="muted">· {online} online</span></h3>
        <ul className="member-list">
          {members.map((u) => (
            <li key={u.id}>
              <Avatar user={u} size={32} />
              <span className="member-main">
                <span>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</span>
                <small className={`p-${presenceOf(u).key}`}>{presenceOf(u).label}{u.title ? <span className="muted"> · {u.title}</span> : null}</small>
              </span>
              {u.id !== me.id && (
                <button
                  className="icon-btn"
                  aria-label={`Message ${u.name}`}
                  onClick={() =>
                    void run(async () => {
                      const r = await api('/api/conversations/dm', { body: { userId: u.id } });
                      go(`chat/${r.conversation.id}`);
                      return r;
                    })
                  }
                >
                  <Icon name="chat" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {conv.type !== 'dm' && conv.joined && (
          showAdd ? (
            <div className="stack-sm">
              <PeoplePicker value={adding} onChange={setAdding} label="Add people" />
              <div className="row gap-xs">
                <button className="btn ghost" onClick={() => (setShowAdd(false), setAdding([]))}>Cancel</button>
                <button
                  className="btn primary"
                  disabled={!adding.length}
                  onClick={() =>
                    void run(async () => {
                      const r = await api(`/api/conversations/${conv.id}/members`, { body: { userIds: adding } });
                      setAdding([]);
                      setShowAdd(false);
                      return r;
                    })
                  }
                >
                  Add {adding.length || ''}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn full" onClick={() => setShowAdd(true)}><Icon name="plus" size={16} /> Add people</button>
          )
        )}
      </section>

      {conv.type !== 'dm' && (
        <section className="panel-section">
          <h3><Icon name="app" size={16} /> Connected apps</h3>
          {apps.length === 0 && <p className="panel-hint">Send alerts from monitoring or status tools into this {conv.type === 'channel' ? 'channel' : 'chat'} with a webhook.</p>}
          <ul className="app-list">
            {apps.map((a) => (
              <li key={a.id}>
                <span className="avatar app-avatar" style={{ width: 32, height: 32, borderRadius: 9 }}><Icon name="app" size={16} /></span>
                <span className="member-main">
                  <span>{a.name} <span className="app-tag">App</span></span>
                  <small className="muted">{a.lastUsedAt ? `Last alert ${timeShort(a.lastUsedAt)}` : 'No alerts yet'}</small>
                </span>
                {conv.joined && (
                  <button className="icon-btn" aria-label={`Disconnect ${a.name}`} onClick={() => confirm(`Disconnect ${a.name}? Its webhook URL will stop working.`) && void run(() => api(`/api/apps/${a.id}`, { method: 'DELETE' }))}>
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {conv.joined && <button className="btn full" onClick={() => setConnect(true)}><Icon name="plus" size={16} /> Connect an app</button>}
        </section>
      )}

      {conv.joined && (
        <section className="panel-section">
          <h3><Icon name="settings" size={16} /> Settings</h3>
          {conv.type !== 'dm' && (
            <form className="stack-sm" onSubmit={(e) => (e.preventDefault(), void run(() => api(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { topic } })))}>
              <label className="field">
                <span>Description</span>
                <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} placeholder="What’s this channel for?" />
              </label>
              {topic !== conv.topic && <button className="btn">Save description</button>}
            </form>
          )}
          <button className="btn ghost full left" onClick={() => void run(() => api(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { muted: !conv.muted } }))}>
            <Icon name={conv.muted ? 'bell' : 'bellOff'} size={18} /> {conv.muted ? 'Unmute notifications' : 'Mute notifications'}
          </button>
          {conv.type !== 'dm' && (
            <button
              className="btn ghost full left danger-text"
              onClick={() =>
                confirm(`Leave ${conv.type === 'channel' ? '#' + conv.name : 'this group'}?`) &&
                void api(`/api/conversations/${conv.id}/leave`, { method: 'POST' })
                  .then(() => (removeConversation(conv.id), go('chat')))
                  .catch((e) => toast(e.message, 'error'))
              }
            >
              <Icon name="logout" size={18} /> Leave {conv.type === 'channel' ? 'channel' : 'group'}
            </button>
          )}
        </section>
      )}
      {connect && <ConnectAppModal conv={conv} onClose={() => setConnect(false)} />}
    </aside>
  );
}

function ConnectAppModal({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const { toast } = useStore();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const url = created ? `${location.origin}/api/hooks/${created.token}` : '';
  const curl = created
    ? `curl -X POST ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"title":"Teams is degraded","text":"Use Relay for chat and calls.","severity":"warning","link":"https://status.example.com"}'`
    : '';
  return (
    <Modal title={created ? `${created.name} is connected` : 'Connect an app'} onClose={onClose} wide={!!created}>
      {created ? (
        <div className="stack">
          <p>Send a <code>POST</code> with JSON to this URL to post an alert card. Keep it secret; anyone with it can post here. It won’t be shown again.</p>
          <div className="copy-row">
            <code className="code-block">{url}</code>
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast('Copied', 'success'))}><Icon name="copy" size={16} /> Copy</button>
          </div>
          <p className="muted small">Fields: <code>title</code> (required), <code>text</code>, <code>severity</code> (info, warning, critical, resolved), <code>link</code>.</p>
          <pre className="code-block">{curl}</pre>
          <div className="modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { app } = await api(`/api/conversations/${conv.id}/apps`, { body: { name } });
              setCreated(app);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        >
          <p className="muted">An app gets a private webhook URL. Point an uptime monitor, status page or script at it and its alerts appear here as cards.</p>
          <label className="field">
            <span>App name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="e.g. Uptime monitor" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary">Create webhook</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
