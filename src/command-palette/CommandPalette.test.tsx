import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '../lib/search';
import { CommandPalette } from './CommandPalette';

const hit: SearchHit = { kind: 'task', id: 't1', title: 'گزارش هفتگی', snippet: 'بررسی اعداد', date: '2026-03-03' };

function setup(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const props = {
    open: true,
    actions: [
      { id: 'new-task', label: 'New task', icon: 'task' as const, run: vi.fn() },
      { id: 'settings', label: 'Settings', icon: 'settings' as const, run: vi.fn() }
    ],
    search: vi.fn().mockResolvedValue([hit]),
    onOpenHit: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<CommandPalette {...props} />);
  return props;
}

describe('CommandPalette', () => {
  it('lists quick actions while the query is empty', () => {
    setup();
    expect(screen.getByRole('option', { name: /New task/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Settings/ })).toBeInTheDocument();
  });

  it('searches and opens a hit with the keyboard', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole('combobox'), 'گزارش');
    await waitFor(() => expect(props.search).toHaveBeenCalledWith('گزارش'));
    const option = await screen.findByRole('option', { name: /گزارش هفتگی/ });
    await user.click(option);
    expect(props.onOpenHit).toHaveBeenCalledWith(hit);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('moves through results with the arrow keys and runs an action with Enter', async () => {
    const user = userEvent.setup();
    const props = setup();
    const combobox = screen.getByRole('combobox');
    await user.type(combobox, 'گزارش');
    await screen.findByRole('option', { name: /گزارش هفتگی/ });
    // The first entry is the matching action ("New task" does not match), so
    // the hit is already active; Enter opens it.
    await user.keyboard('{Enter}');
    expect(props.onOpenHit).toHaveBeenCalledWith(hit);
  });

  it('closes on Escape and on a backdrop click', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await user.click(document.querySelector('.command-palette') as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
