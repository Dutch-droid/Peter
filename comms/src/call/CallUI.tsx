import { useEffect, useRef, useState } from 'react';
import type { User } from '../api';
import { useStore } from '../store';
import { Avatar, duration, Icon } from '../components/ui';
import { useCall } from './CallProvider';

function useSpeaking(stream: MediaStream | null | undefined, enabled = true) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream || !enabled || !stream.getAudioTracks().length) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const t = setInterval(() => {
      an.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setSpeaking(avg > 12);
    }, 200);
    return () => {
      clearInterval(t);
      void ctx.close();
    };
  }, [stream, enabled, stream?.getAudioTracks().length]);
  return speaking;
}

function Tile({ user, stream, isLocal, audioOn, videoOn, screen, state }: {
  user?: User;
  stream?: MediaStream | null;
  isLocal?: boolean;
  audioOn: boolean;
  videoOn: boolean;
  screen: boolean;
  state?: RTCPeerConnectionState;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speaking = useSpeaking(stream, audioOn);
  const showVideo = !!stream && (videoOn || screen) && stream.getVideoTracks().some((t) => t.readyState === 'live');
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== (stream ?? null)) ref.current.srcObject = stream ?? null;
    if (audioRef.current && audioRef.current.srcObject !== (stream ?? null)) audioRef.current.srcObject = stream ?? null;
  });
  return (
    <div className={`tile ${speaking ? 'speaking' : ''} ${screen ? 'tile-screen' : ''}`}>
      {/* Remote audio plays from its own element so it keeps going when video is hidden. */}
      {!isLocal && <audio ref={audioRef} autoPlay />}
      <video ref={ref} autoPlay playsInline muted className={isLocal && !screen ? 'mirror' : ''} style={{ display: showVideo ? 'block' : 'none' }} />
      {!showVideo && (
        <div className="tile-avatar">
          <Avatar user={user} size={84} showPresence={false} />
        </div>
      )}
      <div className="tile-label">
        {!audioOn && <Icon name="micOff" size={14} title="Muted" />}
        {screen && <Icon name="screen" size={14} title="Sharing screen" />}
        <span>{isLocal ? 'You' : (user?.name ?? 'Someone')}</span>
        {state && state !== 'connected' && <em className="tile-state">{state === 'new' || state === 'connecting' ? 'connecting…' : state}</em>}
      </div>
    </div>
  );
}

function Timer({ since }: { since: number | null }) {
  const [, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="timer">{since ? duration(Date.now() - since) : 'Ringing…'}</span>;
}

export function CallWindow() {
  const c = useCall();
  const { me, conversations, conversationName, user } = useStore();
  const call = c.call;
  if (!call) return null;
  const conv = conversations.find((x) => x.id === call.conversationId);
  const title = conv ? conversationName(conv) : 'Call';
  const others = call.participants.filter((p) => p.user.id !== me.id);
  const waitingFor = conv?.memberIds.filter((id) => id !== me.id) ?? [];

  if (c.minimized) {
    return (
      <div className="call-mini" role="region" aria-label="Ongoing call">
        <button className="call-mini-body" onClick={() => c.setMinimized(false)}>
          <span className="pulse" />
          <span>
            <strong>{title}</strong>
            <Timer since={call.answeredAt} />
          </span>
        </button>
        <button className={`round ${c.mic ? '' : 'off'}`} onClick={c.toggleMic} aria-label={c.mic ? 'Mute' : 'Unmute'}>
          <Icon name={c.mic ? 'mic' : 'micOff'} />
        </button>
        <button className="round danger" onClick={c.hangUp} aria-label="Hang up">
          <Icon name="hangup" />
        </button>
      </div>
    );
  }

  const count = others.length + 1;
  return (
    <div className="call-window" role="dialog" aria-label={`Call: ${title}`}>
      <header className="call-head">
        <div>
          <strong>{title}</strong>
          <Timer since={call.answeredAt} />
        </div>
        <button className="icon-btn light" onClick={() => c.setMinimized(true)} aria-label="Minimize call">
          <Icon name="back" />
          <span className="hide-sm">Back to app</span>
        </button>
      </header>
      <div className={`tiles n${Math.min(count, 9)}`}>
        {others.length === 0 && (
          <div className="tile waiting">
            <div className="tile-avatar">
              {waitingFor.slice(0, 3).map((id) => (
                <Avatar key={id} user={user(id)} size={72} showPresence={false} />
              ))}
            </div>
            <div className="tile-label center">
              {call.answeredAt ? 'Waiting for others to join…' : `Calling ${waitingFor.length === 1 ? (user(waitingFor[0])?.name ?? '') : title}…`}
            </div>
          </div>
        )}
        {others.map((p) => (
          <Tile
            key={p.user.id}
            user={p.user}
            stream={c.remotes.get(p.user.id)}
            audioOn={p.audio}
            videoOn={p.video}
            screen={p.screen}
            state={c.connState.get(p.user.id)}
          />
        ))}
        <Tile user={me} stream={c.local} isLocal audioOn={c.mic} videoOn={c.cam} screen={c.screen} />
      </div>
      <footer className="call-controls">
        <button className={`round ${c.mic ? '' : 'off'}`} onClick={c.toggleMic} aria-pressed={!c.mic} aria-label={c.mic ? 'Mute microphone' : 'Unmute microphone'}>
          <Icon name={c.mic ? 'mic' : 'micOff'} size={22} />
        </button>
        <button className={`round ${c.cam ? '' : 'off'}`} onClick={() => void c.toggleCam()} aria-pressed={c.cam} aria-label={c.cam ? 'Turn camera off' : 'Turn camera on'}>
          <Icon name={c.cam ? 'video' : 'videoOff'} size={22} />
        </button>
        <button className={`round ${c.screen ? 'active' : ''}`} onClick={() => void c.toggleScreen()} aria-pressed={c.screen} aria-label={c.screen ? 'Stop sharing' : 'Share screen'}>
          <Icon name="screen" size={22} />
        </button>
        <button className="round danger wide" onClick={c.hangUp} aria-label="Hang up">
          <Icon name="hangup" size={22} />
        </button>
      </footer>
    </div>
  );
}

export function IncomingCalls() {
  const { incoming, joinCall, decline } = useCall();
  const { conversations, conversationName } = useStore();
  if (!incoming.length) return null;
  return (
    <div className="incoming-stack">
      {incoming.map(({ call, from }) => {
        const conv = conversations.find((x) => x.id === call.conversationId);
        const group = conv && conv.type !== 'dm';
        return (
          <div className="incoming" key={call.id} role="alertdialog" aria-label={`Incoming call from ${from.name}`}>
            <Avatar user={from} size={52} showPresence={false} />
            <div className="incoming-text">
              <strong>{from.name}</strong>
              <span>
                {call.media === 'video' ? 'Video call' : 'Voice call'}
                {group && conv ? ` · ${conversationName(conv)}` : ''}
              </span>
            </div>
            <div className="incoming-actions">
              <button className="round danger" onClick={() => decline(call.id)} aria-label="Decline">
                <Icon name="hangup" />
              </button>
              <button className="round accept" onClick={() => void joinCall(call.id, 'audio')} aria-label="Answer with audio">
                <Icon name="phone" />
              </button>
              <button className="round accept" onClick={() => void joinCall(call.id, 'video')} aria-label="Answer with video">
                <Icon name="video" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
