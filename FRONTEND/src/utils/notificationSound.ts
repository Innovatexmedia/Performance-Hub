

let audioContext: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null; // very old browser -- notifications still work, just silently
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/**
 * unlockNotificationSound -- resumes the AudioContext from inside a user
 * gesture. Safe to call repeatedly; a running context stays running.
 */
export function unlockNotificationSound(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      /* Nothing useful to do -- the next gesture gets another go. */
    });
  }
}

/**
 * playNotificationSound -- a short two-note chime (E6 then A6).
 *
 * Deliberately quiet (peak gain 0.12) and short (~260ms). A notification
 * sound that people reach for the mute button over is worse than none, and
 * this fires on every incoming notification.
 *
 * Never throws: audio is a nicety, and a browser refusing to play it must not
 * break the notification itself.
 */
export function playNotificationSound(): void {
  const ctx = getContext();
  if (!ctx) return;

  // Still locked (no gesture yet this session) -- skip rather than queue a
  // sound that would fire at some confusing later moment.
  if (ctx.state === 'suspended') {
    unlockNotificationSound();
    return;
  }

  try {
    const now = ctx.currentTime;
    const notes = [
      { frequency: 1318.51, startAt: 0,     duration: 0.16 }, // E6
      { frequency: 1760.0,  startAt: 0.085, duration: 0.18 }, // A6
    ];

    for (const note of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      // A triangle wave is softer than a square/sawtooth, which sound harsh
      // and cheap at these frequencies.
      oscillator.type = 'triangle';
      oscillator.frequency.value = note.frequency;

      const start = now + note.startAt;
      const end = start + note.duration;

      // Ramps rather than instant on/off: an abrupt gain change produces an
      // audible click at the start and end of the note.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  } catch {
    /* Audio is never load-bearing. */
  }
}