/**
 * Cross-platform haptic feedback.
 *
 * - **Android**: uses `navigator.vibrate()` (Vibration API) — works on Chrome,
 *   Firefox, Samsung Internet, etc.
 * - **iOS**: uses a short burst from the Web Audio API (~200 Hz, 40 ms) which
 *   triggers the Taptic Engine on iPhones when the device is in ring/silent
 *   mode. Silently ignored if the AudioContext fails or iOS doesn't support it.
 * - **Desktop/unsupported**: silently no-oped.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Attempt to trigger haptic feedback via the Web Audio API.
 * This works on iOS by playing a very short, low-frequency tone
 * that the Taptic Engine picks up as a vibration cue.
 */
function iosHaptic(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    // Resume context if suspended (autoplay policy)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 200; // Hz — low enough to feel, high enough to be audible to the haptic engine

    gain.gain.value = 0.3; // Very quiet — just enough to tickle the Taptic Engine
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.04); // 40 ms

    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a short haptic vibration.
 *
 * @param pattern  Duration in ms or Vibration API pattern array.
 *                 Default 12 (a light tap).
 *
 * Works on:
 * - Android (via Vibration API)
 * - iOS (via Web Audio → Taptic Engine)
 * - Desktop (silently ignored)
 */
export function hapticFeedback(pattern: number | number[] = 12): void {
  // Android: Vibration API
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
    return;
  }

  // iOS: Web Audio fallback
  iosHaptic();
}
