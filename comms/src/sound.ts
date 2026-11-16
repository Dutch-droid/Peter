/** Tiny synthesized sounds (Web Audio), so there are no audio files to host. */
let ctx: AudioContext | null = null;
function ac() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.08) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function chime(kind: 'message' | 'alert') {
  try {
    if (kind === 'message') {
      tone(880, 0, 0.18);
      tone(1320, 0.09, 0.22);
    } else {
      tone(660, 0, 0.25, 0.12);
      tone(660, 0.3, 0.25, 0.12);
      tone(990, 0.6, 0.4, 0.12);
    }
  } catch {
    /* audio blocked until the user interacts */
  }
}

let ringTimer: number | undefined;
export function startRinging() {
  stopRinging();
  const ring = () => {
    try {
      tone(740, 0, 0.35, 0.1);
      tone(587, 0.4, 0.45, 0.1);
    } catch {
      /* ignore */
    }
  };
  ring();
  ringTimer = window.setInterval(ring, 2200);
}
export function stopRinging() {
  clearInterval(ringTimer);
  ringTimer = undefined;
}
