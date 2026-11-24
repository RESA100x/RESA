// The Android build runs the same bundle as the desktop app, but a phone needs
// a tabbed, touch-first shell instead of the draggable module grid. Everything
// that changes shape for the phone asks here rather than sniffing the UA again.
export function isMobileShell(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}
