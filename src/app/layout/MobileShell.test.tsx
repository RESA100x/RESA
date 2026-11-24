import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileShell } from './MobileShell';

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
});
