import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileShell } from './MobileShell';
import { t } from '../../i18n';

beforeEach(() => localStorage.clear());

function renderShell() {
  return render(
    <MobileShell
      time="09:41"
      dateText="سه‌شنبه ۳ آذر"
      modules={{
        calendar: <div data-testid="calendar-module">cal</div>,
        kanban: <div data-testid="kanban-module">kan</div>,
        phonebook: <div data-testid="phonebook-module">book</div>
      }}
      onOpenSettings={() => undefined}
      onOpenSearch={() => undefined}
    />
  );
}

describe('MobileShell', () => {
  it('opens on the calendar and swaps the whole screen when a tab is tapped', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByTestId('calendar-module')).toBeInTheDocument();

    await user.click(screen.getByTestId('mobile-tab-kanban'));

    expect(screen.getByTestId('kanban-module')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-module')).not.toBeInTheDocument();
  });

  it('keeps the extra modules behind the more sheet', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByTestId('phonebook-module')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('mobile-tab-more'));
    await user.click(screen.getByTestId('mobile-sheet-phonebook'));

    expect(screen.getByTestId('phonebook-module')).toBeInTheDocument();
  });

  it('routes the header buttons to search and settings', async () => {
    const user = userEvent.setup();
    const onOpenSearch = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <MobileShell
        time="09:41"
        dateText="سه‌شنبه ۳ آذر"
        modules={{ calendar: <div /> }}
        onOpenSettings={onOpenSettings}
        onOpenSearch={onOpenSearch}
      />
    );

    await user.click(screen.getByTestId('mobile-search'));
    await user.click(screen.getByTestId('mobile-settings'));

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the default shortcut bar and runs a module shortcut from it', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByTestId('mobile-shortcut-phonebook')).toBeInTheDocument();

    await user.click(screen.getByTestId('mobile-shortcut-phonebook'));

    expect(screen.getByTestId('phonebook-module')).toBeInTheDocument();
  });

  it('hands create shortcuts to the app', async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn();
    render(
      <MobileShell
        time="09:41"
        dateText="سه‌شنبه ۳ آذر"
        modules={{ calendar: <div /> }}
        onOpenSettings={() => undefined}
        onOpenSearch={() => undefined}
        onQuickAction={onQuickAction}
      />
    );

    await user.click(screen.getByTestId('mobile-shortcut-new-event'));

    expect(onQuickAction).toHaveBeenCalledWith('new-event');
  });

  it('reorders the bar from the shortcut editor and remembers it', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId('mobile-tab-more'));
    await user.click(screen.getByTestId('mobile-shortcuts-manage'));

    const rows = screen.getAllByTestId(/^shortcut-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'shortcut-row-new-event');

    for (let step = 0; step < 3; step += 1) {
      const first = screen.getAllByTestId(/^shortcut-row-/)[0];
      await user.click(within(first).getByLabelText(t('mobile.shortcutLater')));
    }

    expect(screen.getAllByTestId(/^shortcut-row-/)[0]).toHaveAttribute('data-testid', 'shortcut-row-new-task');
    expect(JSON.parse(localStorage.getItem('resa.mobile.shortcuts') ?? '{}').items[0]).toBe('new-task');
  });
});
