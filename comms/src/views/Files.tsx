import { useEffect, useState } from 'react';
import { api, type SharedFile } from '../api';
import { go, useStore } from '../store';
import { socket } from '../socket';
import { bytes, Empty, Icon, timeShort } from '../components/ui';

export function FilesView() {
  const { user, conversations, conversationName } = useStore();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => void api(`/api/files?q=${encodeURIComponent(q)}`).then((r) => setFiles(r.files)), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => socket.on((e) => e.type === 'message:new' && e.message.attachment && api('/api/files').then((r) => setFiles(r.files))), []);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Files</h1>
        <span className="muted">Everything shared with you in chats and mail</span>
      </div>
      <div className="search-field">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files by name" aria-label="Search files" />
      </div>
      <ul className="files-list">
        {files === null && <li className="hint pad">Loading…</li>}
        {files?.length === 0 && <li><Empty icon="file" title={q ? 'No files match' : 'No files yet'}>Files you send or receive in chats and mail show up here.</Empty></li>}
        {files?.map((f) => {
          const conv = f.source === 'chat' ? conversations.find((c) => c.id === f.ref_id) : undefined;
          const where = f.source === 'mail' ? 'Mail' : conv ? conversationName(conv) : 'Chat';
          const ext = f.filename.includes('.') ? f.filename.split('.').pop()!.toUpperCase().slice(0, 5) : 'FILE';
          return (
            <li key={`${f.source}-${f.ref_id}-${f.id}`} className="file-item">
              <span className="file-icon"><Icon name="file" size={22} /></span>
              <span className="file-meta">
                <strong title={f.filename}>{f.filename}</strong>
                <small>{ext} · {bytes(f.size)} · {user(f.shared_by)?.name ?? 'Someone'} · {timeShort(f.shared_at)}</small>
              </span>
              <button className="btn ghost hide-sm" onClick={() => go(f.source === 'mail' ? `mail/inbox/${f.ref_id}` : `chat/${f.ref_id}`)}>
                <Icon name={f.source === 'mail' ? 'mail' : 'chat'} size={16} /> {where}
              </button>
              <a className="btn" href={`/api/attachments/${f.id}?download=1`} aria-label={`Download ${f.filename}`}>
                <Icon name="download" size={18} /> <span className="hide-sm">Download</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
