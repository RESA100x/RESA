import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion';

export const WILT_TRANSITION_MS = 1400;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The illustration never jumps between two states: it walks from the wilt level
// it currently shows to the new one. Watering a plant therefore plays the
// recovery instead of snapping back to fresh, and the first render starts at the
// real level rather than growing up from healthy.
export function useWiltProgress(target: number, animate = true, durationMs = WILT_TRANSITION_MS): number {
  const goal = clamp01(target);
  const [value, setValue] = useState(goal);
  const from = useRef(goal);

  useEffect(() => {
    const start = from.current;
    if (!animate || prefersReducedMotion() || start === goal) {
      from.current = goal;
      setValue(goal);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const next = start + (goal - start) * easeInOutCubic(t);
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [goal, animate, durationMs]);

  return value;
}
