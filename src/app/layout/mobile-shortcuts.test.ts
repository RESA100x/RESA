import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  loadShortcutPrefs,
  moveShortcut,
  saveShortcutPrefs,
  toggleShortcut,
  type MobileShortcutId
} from './mobile-shortcuts';

afterEach(() => localStorage.clear());

describe('mobile shortcut bar preferences', () => {
  it('starts with the default bar when nothing is stored', () => {
    expect(loadShortcutPrefs()).toEqual({ enabled: true, items: DEFAULT_SHORTCUTS });
  });

  it('round-trips the chosen order', () => {
    saveShortcutPrefs({ enabled: false, items: ['search', 'new-note'] });
    expect(loadShortcutPrefs()).toEqual({ enabled: false, items: ['search', 'new-note'] });
  });

  it('drops unknown ids and duplicates instead of breaking the bar', () => {
    localStorage.setItem(
      'resa.mobile.shortcuts',
      JSON.stringify({ enabled: true, items: ['search', 'gone', 'search', 'library'] })
    );
    expect(loadShortcutPrefs().items).toEqual(['search', 'library']);
  });

  it('falls back to the defaults when the stored value is not JSON', () => {
    localStorage.setItem('resa.mobile.shortcuts', '{not json');
    expect(loadShortcutPrefs()).toEqual({ enabled: true, items: DEFAULT_SHORTCUTS });
  });

  it('moves an entry one slot and clamps at the ends', () => {
    const items: MobileShortcutId[] = ['search', 'library', 'phonebook'];
    expect(moveShortcut(items, 'library', -1)).toEqual(['library', 'search', 'phonebook']);
    expect(moveShortcut(items, 'search', -1)).toEqual(items);
    expect(moveShortcut(items, 'phonebook', 1)).toEqual(items);
    expect(moveShortcut(items, 'meetings', 1)).toEqual(items);
  });

  it('adds an entry at the end and removes the ones already there', () => {
    expect(toggleShortcut(['search'], 'library')).toEqual(['search', 'library']);
    expect(toggleShortcut(['search', 'library'], 'search')).toEqual(['library']);
  });
});
