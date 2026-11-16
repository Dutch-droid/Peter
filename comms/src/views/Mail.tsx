import { useCallback, useEffect, useRef, useState } from 'react';
import { api, upload, type Attachment, type Email } from '../api';
import { go, useStore } from '../store';
import { socket } from '../socket';
import { Avatar, bytes, Empty, ErrorState, fullDate, Icon, PeoplePicker, RichText, timeShort } from '../components/ui';
import { AttachmentView } from './Chat';

const FOLDERS: { key: string; label: string; icon: string }[] = [
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'starred', label: 'Starred', icon: 'star' },
  { key: 'sent', label: 'Sent', icon: 'sent' },
  { key: 'drafts', label: 'Drafts', icon: 'draft' },
  { key: 'archive', label: 'Archive', icon: 'archive' },
  { key: 'trash', label: 'Trash', icon: 'trash' },
];

export type Draft = {
  id?: number;
  to: number[];
  cc: number[];
  bcc: number[];
  subject: string;
  body: string;
  importance: 'normal' | 'high';
  attachments: Attachment[];
  inReplyTo?: number;
};
const blank = (): Draft => ({ to: [], cc: [], bcc: [], subject: '', body: '', importance: 'normal', attachments: [] });

function quote(e: Email) {
  return `\n\n\n——— On ${fullDate(e.sentAt ?? e.createdAt)}, ${e.from.name} wrote:\n${(e.body ?? '')
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n')}`;
}
const prefixed = (p: string, s: string) => (s.toLowerCase().startsWith(p.toLowerCase()) ? s : `${p} ${s}`);

export function MailView() {
  const { route, mailCounts } = useStore();
  const [sub, query] = (route.sub ?? 'inbox').split('?');
  const folder = sub === 'compose' ? 'inbox' : sub;
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [compose, setCompose] = useState<Draft | null>(null);
  const selected = route.id;

  useEffect(() => {
    if (sub === 'compose') {
      const to = new URLSearchParams(query).get('to');
      setCompose({ ...blank(), to: to ? [Number(to)] : [] });
      go('mail/inbox');
    }
  }, [sub, query]);

  const load = useCallback(() => {
    api<{ emails: Email[] }>(`/api/mail?folder=${folder}&q=${encodeURIComponent(q)}`)
      .then((r) => (setEmails(r.emails), setListError(null)))
      .catch((e) => setListError(e));
  }, [folder, q]);

  useEffect(() => {
    setEmails(null);
  }, [folder]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => socket.on((e) => (e.type === 'mail:new' || e.type === 'hello') && load()), [load]);

  const openDraft = async (id: number) => {
    const { email } = await api<{ email: Email }>(`/api/mail/${id}`);
    setCompose({
      id: email.id,
      to: email.to.map((p) => p.id),
      cc: email.cc.map((p) => p.id),
      bcc: email.bcc.map((p) => p.id),
      subject: email.subject,
      body: email.body ?? '',
      importance: email.importance,
      attachments: email.attachments,
    });
  };

  return (
    <div className={`mail split3 ${selected ? 'has-detail' : ''}`}>
      <nav className="folders" aria-label="Mail folders">
        <button className="btn primary full compose-btn" onClick={() => setCompose(blank())}>
          <Icon name="edit" size={16} /> New email
        </button>
        {FOLDERS.map((f) => {
          const c = mailCounts[f.key];
          const n = f.key === 'inbox' ? c?.unread : f.key === 'drafts' ? c?.total : 0;
          return (
            <a key={f.key} href={`#/mail/${f.key}`} className={`folder ${folder === f.key ? 'active' : ''}`}>
              <Icon name={f.icon} size={17} />
              <span>{f.label}</span>
              {!!n && <span className={f.key === 'inbox' ? 'badge' : 'count'}>{n}</span>}
            </a>
          );
        })}
      </nav>
      <aside className="list-pane mail-list-pane">
        <div className="list-head">
          <h1>{FOLDERS.find((f) => f.key === folder)?.label ?? 'Mail'}</h1>
          {folder === 'trash' && !!emails?.length && (
            <button
              className="btn ghost small"
              onClick={async () => {
                if (!confirm('Permanently delete everything in Trash?')) return;
                await api('/api/mail/empty-trash', { method: 'POST' });
                load();
                go('mail/trash');
              }}
            >
              Empty trash
            </button>
          )}
        </div>
        <div className="list-search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" aria-label="Search mail" />
        </div>
        <ul className="mail-list">
          {listError != null && (
            <li><ErrorState compact title="Can’t load your mail" error={listError} onRetry={load} /></li>
          )}
          {emails === null && listError == null && <li className="hint pad">Loading…</li>}
          {emails?.length === 0 && <li><Empty icon={FOLDERS.find((f) => f.key === folder)?.icon ?? 'inbox'} title={q ? 'No matches' : 'Nothing here'} /></li>}
          {emails?.map((e) => {
            const who = folder === 'sent' || folder === 'drafts' ? (e.to.length ? `To: ${e.to.map((p) => p.name).join(', ')}` : '(no recipients)') : e.from.name;
            return (
              <li key={e.id}>
                <a
                  href={folder === 'drafts' ? undefined : `#/mail/${folder}/${e.id}`}
                  onClick={folder === 'drafts' ? (ev) => (ev.preventDefault(), void openDraft(e.id)) : undefined}
                  className={`mail-item ${selected === e.id ? 'active' : ''} ${!e.read ? 'unread' : ''}`}
                  role={folder === 'drafts' ? 'button' : undefined}
                  tabIndex={0}
                >
                  <Avatar name={e.from.name} color={e.from.color} size={34} showPresence={false} />
                  <span className="mail-item-main">
                    <span className="conv-top">
                      <span className="conv-name">{who}</span>
                      <span className="conv-time">{timeShort(e.sentAt ?? e.createdAt)}</span>
                    </span>
                    <span className="mail-subject">
                      {e.importance === 'high' && <span className="imp" title="High importance">!</span>}
                      {e.subject || '(no subject)'}
                      {e.attachments.length > 0 && <Icon name="clip" size={13} />}
                    </span>
                    <span className="conv-preview">{e.snippet}</span>
                  </span>
                  {e.starred && <Icon name="star" size={14} className="star-on" />}
                </a>
              </li>
            );
          })}
        </ul>
      </aside>
      {selected ? (
        <Reader key={selected} id={selected} folder={folder} onChanged={load} onCompose={setCompose} />
      ) : (
        <div className="detail">
          <Empty icon="mail" title="Select an email to read">Mail here stays inside your organisation and works even when your usual email is down.</Empty>
        </div>
      )}
      {compose && <Compose initial={compose} onClose={() => (setCompose(null), load())} />}
    </div>
  );
}

function Reader({ id, folder, onChanged, onCompose }: { id: number; folder: string; onChanged: () => void; onCompose: (d: Draft) => void }) {
  const { me, toast } = useStore();
  const [data, setData] = useState<{ email: Email; thread: Email[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setErr(null);
    api(`/api/mail/${id}`)
      .then((d) => {
        setData(d);
        onChanged();
      })
      .catch((e) => setErr(e));
  }, [id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="detail"><ErrorState title="Can’t open this email" error={err} onRetry={() => setAttempt((n) => n + 1)} /></div>;
  if (!data) return <div className="detail"><div className="hint pad">Loading…</div></div>;
  const e = data.email;

  const patch = async (body: object, then?: () => void) => {
    try {
      const r = await api(`/api/mail/${id}`, { method: 'PATCH', body });
      setData((d) => (d ? { ...d, email: { ...d.email, ...r.email, body: d.email.body } } : d));
      onChanged();
      then?.();
    } catch (x) {
      toast((x as Error).message, 'error');
    }
  };
  const reply = (all: boolean) => {
    const to = e.from.id === me.id ? e.to.map((p) => p.id) : [e.from.id];
    const cc = all ? [...e.to, ...e.cc].map((p) => p.id).filter((x) => x !== me.id && !to.includes(x)) : [];
    onCompose({ ...blank(), to, cc, subject: prefixed('Re:', e.subject), body: quote(e), inReplyTo: e.id });
  };
  const forward = () =>
    onCompose({
      ...blank(),
      subject: prefixed('Fwd:', e.subject),
      body: `\n\n\n——— Forwarded message ———\nFrom: ${e.from.name} <${e.from.email}>\nDate: ${fullDate(e.sentAt ?? e.createdAt)}\nSubject: ${e.subject}\nTo: ${e.to.map((p) => p.name).join(', ')}\n\n${e.body}`,
      attachments: e.attachments,
    });
  const thread = data.thread.length > 1 ? data.thread : [e];

  return (
    <section className="detail reader">
      <header className="pane-head">
        <a href={`#/mail/${folder}`} className="icon-btn back-btn" aria-label="Back to list"><Icon name="back" /></a>
        <div className="pane-title">
          <h2>{e.subject || '(no subject)'}</h2>
          {thread.length > 1 && <span className="sub">{thread.length} messages in this conversation</span>}
        </div>
        <div className="row gap-xs wrap">
          <button className="icon-btn" onClick={() => void patch({ starred: !e.starred })} aria-label={e.starred ? 'Unstar' : 'Star'} aria-pressed={e.starred} title="Star">
            <Icon name="star" className={e.starred ? 'star-on' : ''} />
          </button>
          {folder !== 'archive' && folder !== 'trash' && (
            <button className="icon-btn" onClick={() => void patch({ folder: 'archive' }, () => go(`mail/${folder}`))} aria-label="Archive" title="Archive">
              <Icon name="archive" />
            </button>
          )}
          {folder === 'trash' ? (
            <>
              <button className="btn ghost small" onClick={() => void patch({ folder: e.from.id === me.id ? 'sent' : 'inbox' }, () => go('mail/trash'))}>Restore</button>
              <button
                className="btn ghost small danger-text"
                onClick={async () => {
                  if (!confirm('Delete this email forever?')) return;
                  await api(`/api/mail/${id}`, { method: 'DELETE' });
                  onChanged();
                  go('mail/trash');
                }}
              >
                Delete forever
              </button>
            </>
          ) : (
            <button className="icon-btn" onClick={() => void patch({ folder: 'trash' }, () => go(`mail/${folder}`))} aria-label="Delete" title="Delete">
              <Icon name="trash" />
            </button>
          )}
          <button className="icon-btn" onClick={() => void patch({ read: false }, () => go(`mail/${folder}`))} aria-label="Mark as unread" title="Mark as unread">
            <Icon name="mail" />
          </button>
        </div>
      </header>
      <div className="reader-body">
        {thread.map((m) => (
          <article key={m.id} className={`email ${m.id === e.id ? 'current' : ''}`}>
            <header className="email-head">
              <Avatar name={m.from.name} color={m.from.color} size={40} showPresence={false} />
              <div>
                <div>
                  <strong>{m.from.name}</strong> <span className="muted">&lt;{m.from.email}&gt;</span>
                  {m.importance === 'high' && <span className="pill warn">High importance</span>}
                </div>
                <div className="muted small">
                  To: {m.to.map((p) => p.name).join(', ') || '—'}
                  {m.cc.length > 0 && <> · Cc: {m.cc.map((p) => p.name).join(', ')}</>}
                  {m.bcc.length > 0 && <> · Bcc: {m.bcc.map((p) => p.name).join(', ')}</>}
                </div>
              </div>
              <time className="muted small">{fullDate(m.sentAt ?? m.createdAt)}</time>
            </header>
            <div className="email-body">
              <RichText text={m.body ?? ''} />
            </div>
            {m.attachments.length > 0 && (
              <div className="email-atts">
                {m.attachments.map((a) => (
                  <AttachmentView key={a.id} a={a} />
                ))}
              </div>
            )}
          </article>
        ))}
        <div className="reader-actions">
          <button className="btn" onClick={() => reply(false)}><Icon name="reply" size={16} /> Reply</button>
          {e.to.length + e.cc.length > 1 && <button className="btn" onClick={() => reply(true)}><Icon name="reply" size={16} /> Reply all</button>}
          <button className="btn" onClick={forward}><Icon name="forward" size={16} /> Forward</button>
        </div>
      </div>
    </section>
  );
}

function Compose({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { toast, config } = useStore();
  const [d, setD] = useState<Draft>(initial);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploading, setUploading] = useState(false);
  const dirty = useRef(false);
  const dRef = useRef(d);
  dRef.current = d;
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initial.inReplyTo && bodyRef.current) {
      bodyRef.current.focus();
      bodyRef.current.setSelectionRange(0, 0);
    }
  }, [initial.inReplyTo]);

  const payload = (x: Draft) => ({ ...x, attachmentIds: x.attachments.map((a) => a.id), attachments: undefined });
  const saveDraft = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaved('saving');
    try {
      const { email } = await api('/api/mail/drafts', { body: payload(dRef.current) });
      setD((cur) => ({ ...cur, id: email.id }));
      dRef.current = { ...dRef.current, id: email.id };
      setSaved('saved');
    } catch {
      setSaved('idle');
    }
  }, []);

  // Autosave every few seconds while typing.
  useEffect(() => {
    const t = setInterval(() => void saveDraft(), 4000);
    return () => clearInterval(t);
  }, [saveDraft]);

  const set = (patch: Partial<Draft>) => {
    dirty.current = true;
    setD((cur) => ({ ...cur, ...patch }));
  };

  const send = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!d.to.length && !d.cc.length && !d.bcc.length) return toast('Add at least one recipient', 'error');
    setBusy(true);
    try {
      await api('/api/mail/send', { body: payload(dRef.current) });
      dirty.current = false;
      toast('Email sent', 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (d.id) await api(`/api/mail/${d.id}`, { method: 'PATCH', body: { folder: 'trash' } }).catch(() => {});
    dirty.current = false;
    onClose();
  };

  const close = async () => {
    const hasContent = d.subject || d.body.trim() || d.to.length;
    if (hasContent) {
      dirty.current = true;
      await saveDraft();
      toast('Saved to Drafts');
    }
    onClose();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    try {
      for (const f of files) {
        if (f.size > config.maxUploadBytes) {
          toast(`${f.name} is larger than ${bytes(config.maxUploadBytes)}`, 'error');
          continue;
        }
        const a = await upload(f);
        set({ attachments: [...dRef.current.attachments, a] });
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="compose-backdrop">
      <form className="compose" onSubmit={send} aria-label="New email" onKeyDown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? void send() : e.key === 'Escape' && void close())}>
        <header className="compose-head">
          <h2>{d.inReplyTo ? 'Reply' : d.subject.startsWith('Fwd:') ? 'Forward' : 'New email'}</h2>
          <span className="muted small">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Draft saved' : ''}</span>
          <button type="button" className="icon-btn" onClick={() => void close()} aria-label="Close and save draft">
            <Icon name="close" />
          </button>
        </header>
        <div className="compose-fields">
          <div className="compose-line">
            <label htmlFor="mail-to">To</label>
            <PeoplePicker id="mail-to" value={d.to} onChange={(to) => set({ to })} excludeMe={false} label="To" />
            {!showCc && <button type="button" className="link" onClick={() => setShowCc(true)}>Cc/Bcc</button>}
          </div>
          {showCc && (
            <>
              <div className="compose-line">
                <label htmlFor="mail-cc">Cc</label>
                <PeoplePicker id="mail-cc" value={d.cc} onChange={(cc) => set({ cc })} excludeMe={false} label="Cc" />
              </div>
              <div className="compose-line">
                <label htmlFor="mail-bcc">Bcc</label>
                <PeoplePicker id="mail-bcc" value={d.bcc} onChange={(bcc) => set({ bcc })} excludeMe={false} label="Bcc" />
              </div>
            </>
          )}
          <div className="compose-line">
            <label htmlFor="mail-subject">Subject</label>
            <input id="mail-subject" value={d.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={300} />
          </div>
        </div>
        <textarea ref={bodyRef} className="compose-body" value={d.body} onChange={(e) => set({ body: e.target.value })} aria-label="Message body" placeholder="Write your message…" />
        {d.attachments.length > 0 && (
          <div className="compose-atts">
            {d.attachments.map((a) => (
              <span className="chip" key={a.id}>
                <Icon name="clip" size={12} /> {a.filename} <small>{bytes(a.size)}</small>
                <button type="button" onClick={() => set({ attachments: d.attachments.filter((x) => x.id !== a.id) })} aria-label={`Remove ${a.filename}`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <footer className="compose-foot">
          <button className="btn primary" disabled={busy || uploading}>
            <Icon name="send" size={16} /> {busy ? 'Sending…' : 'Send'}
          </button>
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach files" disabled={uploading}>
            <Icon name="clip" />
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => (void addFiles(e.target.files), (e.target.value = ''))} />
          <label className="check">
            <input type="checkbox" checked={d.importance === 'high'} onChange={(e) => set({ importance: e.target.checked ? 'high' : 'normal' })} />
            High importance
          </label>
          <span className="grow" />
          <span className="muted small hide-sm">Ctrl+Enter to send</span>
          <button type="button" className="icon-btn" onClick={() => void discard()} aria-label="Discard draft" title="Discard">
            <Icon name="trash" />
          </button>
        </footer>
      </form>
    </div>
  );
}
