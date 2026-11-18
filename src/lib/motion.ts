// Motion preferences. Kept in `lib` because more than one feature needs to
// honour the OS setting — the task completion celebration and the plant
// illustrations both fade/settle, and neither may animate for someone who asked
// for less motion.
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
