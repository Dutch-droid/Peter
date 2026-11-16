import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LiveCall, User } from '../api';
import { socket } from '../socket';
import { useStore, notify } from '../store';
import { startRinging, stopRinging } from '../sound';

/**
 * Mesh WebRTC: every participant holds one RTCPeerConnection per other participant.
 * Existing participants send the offer to whoever joins, so there is never offer "glare".
 * Each connection always has one audio and one video transceiver, so turning the camera on,
 * off, or switching to screen share is a replaceTrack() call with no renegotiation.
 */

type Peer = { pc: RTCPeerConnection; stream: MediaStream; pendingIce: RTCIceCandidateInit[]; offerer: boolean };
type Incoming = { call: LiveCall; from: User };

type CallApi = {
  call: LiveCall | null;
  incoming: Incoming[];
  local: MediaStream | null;
  remotes: Map<number, MediaStream>;
  connState: Map<number, RTCPeerConnectionState>;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  startCall: (conversationId: number, media: 'audio' | 'video') => Promise<void>;
  joinCall: (callId: number, media?: 'audio' | 'video') => Promise<void>;
  decline: (callId: number) => void;
  hangUp: () => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
};

const Ctx = createContext<CallApi | null>(null);
export const useCall = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('No call context');
  return c;
};

async function getMedia(video: boolean): Promise<{ stream: MediaStream; note?: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: new MediaStream(), note: 'This browser can’t use a microphone here (calls need HTTPS or localhost). You can still listen.' };
  }
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false }) };
  } catch {
    if (video) {
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio }), note: 'Camera unavailable, joined with audio only.' };
      } catch {
        /* fall through */
      }
    }
    return { stream: new MediaStream(), note: 'Microphone unavailable or blocked, you joined muted and can still listen.' };
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { config, toast, me, conversations } = useStore();
  const [call, setCall] = useState<LiveCall | null>(null);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Map<number, MediaStream>>(new Map());
  const [connState, setConnState] = useState<Map<number, RTCPeerConnectionState>>(new Map());
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(false);
  const [screen, setScreen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const peers = useRef(new Map<number, Peer>());
  const localRef = useRef<MediaStream | null>(null);
  const callRef = useRef<LiveCall | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  const iceRef = useRef(config.iceServers);
  iceRef.current = config.iceServers;
  const convRef = useRef(conversations);
  convRef.current = conversations;
  callRef.current = call;

  const currentVideoTrack = () => screenTrack.current ?? (camTrack.current?.enabled !== false ? camTrack.current : null);

  const sendSignal = (to: number, data: unknown) => {
    const c = callRef.current;
    if (c) socket.send({ type: 'call:signal', callId: c.id, to, data });
  };
  const publishMedia = (state: { audio?: boolean; video?: boolean; screen?: boolean }) => {
    const c = callRef.current;
    if (c) socket.send({ type: 'call:media', callId: c.id, ...state });
  };

  const closePeer = (uid: number) => {
    const p = peers.current.get(uid);
    if (!p) return;
    p.pc.close();
    peers.current.delete(uid);
    setRemotes((m) => {
      const n = new Map(m);
      n.delete(uid);
      return n;
    });
    setConnState((m) => {
      const n = new Map(m);
      n.delete(uid);
      return n;
    });
  };

  const makePeer = (uid: number, offerer: boolean): Peer => {
    closePeer(uid);
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const stream = new MediaStream();
    const peer: Peer = { pc, stream, pendingIce: [], offerer };
    peers.current.set(uid, peer);
    pc.onicecandidate = (e) => e.candidate && sendSignal(uid, { kind: 'ice', candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      setRemotes((m) => new Map(m).set(uid, stream));
    };
    pc.onconnectionstatechange = () => {
      setConnState((m) => new Map(m).set(uid, pc.connectionState));
      // Network blip: the offering side restarts ICE.
      if (pc.connectionState === 'failed' && peer.offerer && peers.current.get(uid) === peer) {
        pc.restartIce();
        void pc
          .createOffer({ iceRestart: true })
          .then((o) => pc.setLocalDescription(o))
          .then(() => sendSignal(uid, { kind: 'offer', sdp: pc.localDescription }));
      }
    };
    return peer;
  };

  const onPeerJoined = async (uid: number) => {
    // I was already in the call: I make the offer to the newcomer.
    const peer = makePeer(uid, true);
    const s = localRef.current;
    peer.pc.addTransceiver(s?.getAudioTracks()[0] ?? 'audio', { direction: 'sendrecv', streams: s ? [s] : [] });
    peer.pc.addTransceiver(currentVideoTrack() ?? 'video', { direction: 'sendrecv', streams: s ? [s] : [] });
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sendSignal(uid, { kind: 'offer', sdp: peer.pc.localDescription });
  };

  const onSignal = async (from: number, data: any) => {
    let peer = peers.current.get(from);
    if (data.kind === 'offer') {
      const restart = peer && peer.pc.signalingState !== 'closed' && peer.pc.remoteDescription;
      if (!restart) peer = makePeer(from, false);
      const pc = peer!.pc;
      await pc.setRemoteDescription(data.sdp);
      if (!restart) {
        for (const t of pc.getTransceivers()) {
          const kind = t.receiver.track.kind;
          t.direction = 'sendrecv';
          const track = kind === 'audio' ? (localRef.current?.getAudioTracks()[0] ?? null) : currentVideoTrack();
          await t.sender.replaceTrack(track);
          if (localRef.current) t.sender.setStreams?.(localRef.current);
        }
      }
      for (const c of peer!.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, { kind: 'answer', sdp: pc.localDescription });
    } else if (data.kind === 'answer' && peer) {
      await peer.pc.setRemoteDescription(data.sdp);
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.kind === 'ice' && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingIce.push(data.candidate);
    }
  };

  const cleanup = useCallback(() => {
    for (const uid of [...peers.current.keys()]) closePeer(uid);
    localRef.current?.getTracks().forEach((t) => t.stop());
    camTrack.current?.stop();
    screenTrack.current?.stop();
    localRef.current = null;
    camTrack.current = null;
    screenTrack.current = null;
    setLocal(null);
    setCall(null);
    callRef.current = null;
    setScreen(false);
    setCam(false);
    setMic(true);
    setMinimized(false);
  }, []);

  const prepareLocal = async (video: boolean) => {
    const { stream, note } = await getMedia(video);
    if (note) toast(note);
    localRef.current = stream;
    camTrack.current = stream.getVideoTracks()[0] ?? null;
    setLocal(stream);
    setCam(!!camTrack.current);
    setMic(stream.getAudioTracks().length > 0);
    return stream;
  };

  const startCall = useCallback(
    async (conversationId: number, media: 'audio' | 'video') => {
      if (callRef.current) {
        if (callRef.current.conversationId === conversationId) return setMinimized(false);
        toast('Hang up your current call first', 'error');
        return;
      }
      if (!socket.connected) return toast('Not connected. Reconnecting…', 'error');
      const stream = await prepareLocal(media === 'video');
      try {
        const c = await socket.request<LiveCall>({ type: 'call:start', conversationId, media });
        setCall(c);
        callRef.current = c;
        publishMedia({ audio: stream.getAudioTracks().length > 0, video: !!camTrack.current, screen: false });
        // Joined an already-running meeting: existing participants will offer to us.
      } catch (e) {
        cleanup();
        toast((e as Error).message, 'error');
      }
    },
    [cleanup, toast],
  );

  const joinCall = useCallback(
    async (callId: number, media?: 'audio' | 'video') => {
      if (callRef.current?.id === callId) return setMinimized(false);
      if (callRef.current) {
        toast('Hang up your current call first', 'error');
        return;
      }
      stopRinging();
      setIncoming((l) => l.filter((i) => i.call.id !== callId));
      const stream = await prepareLocal(media === 'video');
      try {
        const c = await socket.request<LiveCall>({ type: 'call:join', callId });
        setCall(c);
        callRef.current = c;
        publishMedia({ audio: stream.getAudioTracks().length > 0, video: !!camTrack.current, screen: false });
      } catch (e) {
        cleanup();
        toast((e as Error).message, 'error');
      }
    },
    [cleanup, toast],
  );

  const decline = useCallback((callId: number) => {
    socket.send({ type: 'call:decline', callId });
    setIncoming((l) => l.filter((i) => i.call.id !== callId));
  }, []);

  const hangUp = useCallback(() => {
    const c = callRef.current;
    if (c) socket.send({ type: 'call:leave', callId: c.id });
    cleanup();
  }, [cleanup]);

  const toggleMic = useCallback(() => {
    const t = localRef.current?.getAudioTracks()[0];
    if (!t) return toast('No microphone available', 'error');
    t.enabled = !t.enabled;
    setMic(t.enabled);
    publishMedia({ audio: t.enabled });
  }, [toast]);

  const setVideoTrack = async (track: MediaStreamTrack | null) => {
    for (const p of peers.current.values()) {
      const sender = p.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
      await sender?.replaceTrack(track);
    }
  };

  const refreshLocalPreview = () => {
    const tracks = [...(localRef.current?.getAudioTracks() ?? [])];
    const v = currentVideoTrack();
    if (v) tracks.push(v);
    const s = new MediaStream(tracks);
    setLocal(s);
  };

  const toggleCam = useCallback(async () => {
    if (camTrack.current) {
      camTrack.current.stop();
      camTrack.current = null;
      setCam(false);
      if (!screenTrack.current) await setVideoTrack(null);
      publishMedia({ video: false });
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        camTrack.current = s.getVideoTracks()[0];
        setCam(true);
        if (!screenTrack.current) await setVideoTrack(camTrack.current);
        publishMedia({ video: true });
      } catch {
        toast('Camera unavailable or blocked', 'error');
      }
    }
    refreshLocalPreview();
  }, [toast]);

  const toggleScreen = useCallback(async () => {
    if (screenTrack.current) {
      screenTrack.current.stop();
      screenTrack.current = null;
      setScreen(false);
      await setVideoTrack(camTrack.current);
      publishMedia({ screen: false });
      refreshLocalPreview();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) return toast('Screen sharing is not supported in this browser', 'error');
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = s.getVideoTracks()[0];
      screenTrack.current = track;
      track.onended = () => {
        if (screenTrack.current === track) void toggleScreenRef.current();
      };
      setScreen(true);
      await setVideoTrack(track);
      publishMedia({ screen: true });
      refreshLocalPreview();
    } catch {
      /* user cancelled the picker */
    }
  }, [toast]);
  const toggleScreenRef = useRef(toggleScreen);
  toggleScreenRef.current = toggleScreen;

  useEffect(() => {
    return socket.on((e) => {
      const c = callRef.current;
      switch (e.type) {
        case 'call:ring': {
          const conv = convRef.current.find((x) => x.id === e.call.conversationId);
          // Channels don't ring everyone; the chat shows a "Join" banner instead.
          if (conv?.type === 'channel' || e.from.id === me.id) break;
          setIncoming((l) => [...l.filter((i) => i.call.id !== e.call.id), { call: e.call, from: e.from }]);
          if (me.status !== 'dnd') startRinging();
          notify(`${e.from.name} is calling`, e.call.media === 'video' ? 'Video call' : 'Voice call', () => window.focus(), true);
          break;
        }
        case 'call:answered-elsewhere':
          if (e.connId !== socket.connId) {
            setIncoming((l) => l.filter((i) => i.call.id !== e.callId));
          }
          break;
        case 'call:moved':
          if (c && c.id === e.callId && e.connId === socket.connId) {
            cleanup();
            toast('Call continued on another device');
          }
          break;
        case 'call:state':
          if (c && c.id === e.call.id) setCall(e.call);
          break;
        case 'call:ended':
          setIncoming((l) => l.filter((i) => i.call.id !== e.callId));
          if (c && c.id === e.callId) {
            const solo = !c.answeredAt;
            cleanup();
            if (solo && e.status === 'missed') toast('No answer');
            else if (e.status === 'declined') toast('Call declined');
            else toast('Call ended');
          }
          break;
        case 'call:peer-joined':
          if (c && c.id === e.callId && e.user.id !== me.id) void onPeerJoined(e.user.id);
          break;
        case 'call:peer-left':
          if (c && c.id === e.callId) closePeer(e.userId);
          break;
        case 'call:signal':
          if (c && c.id === e.callId) void onSignal(e.from, e.data).catch((err) => console.warn('signal failed', err));
          break;
        case 'socket:down':
          if (c) {
            cleanup();
            toast('Connection lost, the call ended. Reconnecting…', 'error');
          }
          setIncoming([]);
          break;
      }
    });
  }, [cleanup, toast, me.id, me.status]);

  useEffect(() => {
    if (!incoming.length) stopRinging();
  }, [incoming.length]);

  // Leaving the page: tell the server right away instead of waiting for the socket to time out.
  useEffect(() => {
    const bye = () => {
      const c = callRef.current;
      if (c) socket.send({ type: 'call:leave', callId: c.id });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  return (
    <Ctx.Provider
      value={{ call, incoming, local, remotes, connState, mic, cam, screen, minimized, setMinimized, startCall, joinCall, decline, hangUp, toggleMic, toggleCam, toggleScreen }}
    >
      {children}
    </Ctx.Provider>
  );
}
