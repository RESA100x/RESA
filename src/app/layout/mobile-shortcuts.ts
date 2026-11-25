import {
  BarChart3,
  Book,
  CalendarDays,
  Clock3,
  Droplets,
  FolderOpen,
  History,
  Phone,
  Search,
  Settings,
  SmileCircle,
  SquareKanban,
  Text,
  UserCircle,
  type AppIcon
} from '../../components/icons';

/** The actions a phone user can pin to the shortcut bar above the tabs. */
export type MobileShortcutId =
  | 'new-event'
  | 'new-task'
  | 'new-note'
  | 'search'
  | 'settings'
  | 'phonebook'
  | 'meetings'
  | 'projects'
  | 'library'
  | 'reports'
  | 'archive'
  | 'time'
  | 'plants'
  | 'stickers'
  | 'account';

export type MobileShortcutEntry = {
  id: MobileShortcutId;
  labelKey: string;
  icon: AppIcon;
};

// Labels reuse the strings the modules already carry, so the bar speaks the
// same language as the rest of the app instead of inventing a second name for
// "phone book".
export const SHORTCUT_CATALOG: MobileShortcutEntry[] = [
  { id: 'new-event', labelKey: 'calendar.newEvent', icon: CalendarDays },
  { id: 'new-task', labelKey: 'matrix.newTask', icon: SquareKanban },
  { id: 'new-note', labelKey: 'notesWidget.newNote', icon: Text },
  { id: 'search', labelKey: 'commandPalette.open', icon: Search },
  { id: 'settings', labelKey: 'settings.title', icon: Settings },
  { id: 'phonebook', labelKey: 'widget.phonebook.name', icon: Phone },
  { id: 'meetings', labelKey: 'widget.meetings.name', icon: UserCircle },
  { id: 'projects', labelKey: 'widget.projects.name', icon: FolderOpen },
  { id: 'library', labelKey: 'widget.library.name', icon: Book },
  { id: 'reports', labelKey: 'widget.reports.name', icon: BarChart3 },
  { id: 'archive', labelKey: 'widget.archive.name', icon: History },
  { id: 'time', labelKey: 'widget.time.name', icon: Clock3 },
  { id: 'plants', labelKey: 'widget.plants.name', icon: Droplets },
  { id: 'stickers', labelKey: 'widget.stickers.name', icon: SmileCircle },
  { id: 'account', labelKey: 'account.open', icon: UserCircle }
];

export type MobileShortcutPrefs = {
  enabled: boolean;
  items: MobileShortcutId[];
};

export const DEFAULT_SHORTCUTS: MobileShortcutId[] = ['new-event', 'new-task', 'new-note', 'phonebook'];

const STORAGE_KEY = 'resa.mobile.shortcuts';

const KNOWN_IDS = new Set<string>(SHORTCUT_CATALOG.map((entry) => entry.id));

/** Keeps only ids this build knows, so a removed shortcut never breaks the bar. */
function sanitize(items: unknown): MobileShortcutId[] {
  if (!Array.isArray(items)) return [...DEFAULT_SHORTCUTS];
  const seen = new Set<string>();
  const clean: MobileShortcutId[] = [];
  for (const item of items) {
    if (typeof item !== 'string' || !KNOWN_IDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    clean.push(item as MobileShortcutId);
  }
  return clean;
}

export function loadShortcutPrefs(): MobileShortcutPrefs {
  if (typeof localStorage === 'undefined') return { enabled: true, items: [...DEFAULT_SHORTCUTS] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, items: [...DEFAULT_SHORTCUTS] };
    const parsed = JSON.parse(raw) as Partial<MobileShortcutPrefs>;
    return { enabled: parsed.enabled !== false, items: sanitize(parsed.items) };
  } catch {
    return { enabled: true, items: [...DEFAULT_SHORTCUTS] };
  }
}

export function saveShortcutPrefs(prefs: MobileShortcutPrefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A full or disabled storage must not stop the bar from working for the
    // rest of the session; the preference simply will not survive a restart.
  }
}

/** Moves an entry one slot earlier (-1) or later (+1), clamped to the ends. */
export function moveShortcut(items: MobileShortcutId[], id: MobileShortcutId, delta: number): MobileShortcutId[] {
  const index = items.indexOf(id);
  if (index < 0) return items;
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}

export function toggleShortcut(items: MobileShortcutId[], id: MobileShortcutId): MobileShortcutId[] {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}
