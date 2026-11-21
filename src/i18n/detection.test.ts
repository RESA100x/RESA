import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.resetModules();
});

it('opens a fresh install in Persian whatever the system language is', async () => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
  expect((await import('./store')).getLanguage()).toBe('fa');
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
});

it('does not persist the default, so the first explicit choice is the saved one', async () => {
  vi.resetModules();
  localStorage.clear();
  await import('./store');
  expect(localStorage.getItem('nowly.language')).toBeNull();
});

it('preserves an explicit saved choice', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'ja');
  expect((await import('./store')).getLanguage()).toBe('ja');
});

it('follows the saved choice again when it is cleared in another window', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'ja');
  const store = await import('./store');
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  try {
    localStorage.removeItem('nowly.language');
    window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: null }));
    expect(store.getLanguage()).toBe('fa');
    expect(document.documentElement.lang).toBe('fa');
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
  }
});

it.each(['fr', 'es', 'ja', 'ko', 'zh-Hant', 'en'])('restores saved %s across module reloads', async (language) => {
  vi.resetModules();
  localStorage.setItem('nowly.language', language);
  expect((await import('./store')).getLanguage()).toBe(language);
});

it('ignores a corrupt or removed saved value and falls back to Persian', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'ar');
  expect((await import('./store')).getLanguage()).toBe('fa');

  vi.resetModules();
  localStorage.setItem('nowly.language', 'not-a-language');
  expect((await import('./store')).getLanguage()).toBe('fa');
});

it('can initialize when storage access is unavailable', async () => {
  vi.resetModules();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect((await import('./store')).getLanguage()).toBe('fa');
});
