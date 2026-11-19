/**
 * Copy a string, preferring the async Clipboard API and falling back to the
 * old selection trick. A phone book is mostly used to hand a number to someone,
 * so copying has to work in the Tauri webview (where `navigator.clipboard` is
 * available) and in a plain browser tab during development. Returns false when
 * both paths fail, so the caller can stay quiet instead of claiming success.
 */
export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the selection fallback (e.g. a denied permission).
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
