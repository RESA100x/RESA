import { ChevronDown, ChevronUp, Plus, Trash2, X } from '../../components/icons';
import { t } from '../../i18n';
import {
  SHORTCUT_CATALOG,
  moveShortcut,
  toggleShortcut,
  type MobileShortcutId,
  type MobileShortcutPrefs
} from './mobile-shortcuts';

const BY_ID = new Map(SHORTCUT_CATALOG.map((entry) => [entry.id, entry]));

type Props = {
  prefs: MobileShortcutPrefs;
  onChange: (prefs: MobileShortcutPrefs) => void;
  onClose: () => void;
};

/**
 * The shortcut bar editor. A phone has no drag handles worth trusting, so an
 * entry moves with two explicit arrows; the same arrows work with a keyboard
 * and with a screen reader, which a drag gesture would not.
 */
export function MobileShortcutsSheet({ prefs, onChange, onClose }: Props) {
  // Follow the saved order, not the catalogue order: the arrows only mean
  // something if the list is drawn the way the bar will be.
  const chosen = prefs.items
    .map((id) => BY_ID.get(id))
    .filter((entry): entry is (typeof SHORTCUT_CATALOG)[number] => entry !== undefined);
  const available = SHORTCUT_CATALOG.filter((entry) => !prefs.items.includes(entry.id));

  function move(id: MobileShortcutId, delta: number) {
    onChange({ ...prefs, items: moveShortcut(prefs.items, id, delta) });
  }

  return (
    <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={t('mobile.shortcutsManage')}>
      <button type="button" className="mobile-sheet__backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div className="mobile-sheet__panel mobile-shortcuts">
        <div className="mobile-sheet__head">
          <span>{t('mobile.shortcutsManage')}</span>
          <button type="button" className="mobile-shell__icon" aria-label={t('common.close')} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <p className="mobile-shortcuts__hint">{t('mobile.shortcutsHint')}</p>

        <label className="form-check form-check-custom form-check-solid mobile-shortcuts__toggle">
          <input
            className="form-check-input"
            type="checkbox"
            checked={prefs.enabled}
            onChange={(event) => onChange({ ...prefs, enabled: event.target.checked })}
          />
          <span className="form-check-label">{t('mobile.shortcutsShow')}</span>
        </label>

        <h4 className="mobile-shortcuts__title">{t('mobile.shortcuts')}</h4>
        {chosen.length === 0 ? (
          <p className="mobile-shortcuts__empty">{t('mobile.shortcutsEmpty')}</p>
        ) : (
          <ul className="mobile-shortcuts__list">
            {chosen.map((entry, index) => {
              const Icon = entry.icon;
              return (
                <li key={entry.id} className="mobile-shortcuts__row" data-testid={`shortcut-row-${entry.id}`}>
                  <span className="mobile-shortcuts__glyph" aria-hidden="true"><Icon /></span>
                  <span className="mobile-shortcuts__label">{t(entry.labelKey)}</span>
                  <button
                    type="button"
                    className="mobile-shortcuts__action"
                    aria-label={t('mobile.shortcutEarlier')}
                    title={t('mobile.shortcutEarlier')}
                    disabled={index === 0}
                    onClick={() => move(entry.id, -1)}
                  >
                    <ChevronUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mobile-shortcuts__action"
                    aria-label={t('mobile.shortcutLater')}
                    title={t('mobile.shortcutLater')}
                    disabled={index === chosen.length - 1}
                    onClick={() => move(entry.id, 1)}
                  >
                    <ChevronDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mobile-shortcuts__action mobile-shortcuts__action--danger"
                    aria-label={t('mobile.shortcutRemove')}
                    title={t('mobile.shortcutRemove')}
                    onClick={() => onChange({ ...prefs, items: toggleShortcut(prefs.items, entry.id) })}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {available.length > 0 ? (
          <>
            <h4 className="mobile-shortcuts__title">{t('mobile.shortcutsAdd')}</h4>
            <div className="mobile-shortcuts__add">
              {available.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="mobile-shortcuts__chip"
                    data-testid={`shortcut-add-${entry.id}`}
                    onClick={() => onChange({ ...prefs, items: toggleShortcut(prefs.items, entry.id) })}
                  >
                    <Icon aria-hidden="true" />
                    <span>{t(entry.labelKey)}</span>
                    <Plus aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
