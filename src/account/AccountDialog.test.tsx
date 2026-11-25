import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { setLanguage } from '../i18n/store';
import { AccountDialog } from './AccountDialog';

const emptyProfile = {
  fullName: '',
  birthDate: null,
  nationalId: '',
  phone: '',
  email: '',
  jobTitle: '',
  organization: '',
  address: '',
  bio: '',
  avatar: '',
  updatedAt: null
};

const lockedVault = { initialized: true, unlocked: false, documentCount: 2, totalBytes: 4096 };

beforeEach(() => {
  setLanguage('en');
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'profile_get') return Promise.resolve(emptyProfile);
    if (command === 'profile_save') {
      return Promise.resolve({ ...(args?.draft as object), updatedAt: '2026-01-01T00:00:00.000Z' });
    }
    if (command === 'vault_status') return Promise.resolve(lockedVault);
    if (command === 'vault_list_documents') return Promise.resolve([]);
    if (command === 'sync_get_status') {
      return Promise.resolve({
        configured: false,
        enabled: false,
        endpoint: null,
        email: null,
        phone: null,
        signedIn: false,
        lastSyncAt: null,
        pendingChanges: 0,
        deviceId: 'test'
      });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

afterEach(() => setLanguage('zh'));

describe('AccountDialog', () => {
  it('opens on the profile tab and saves the person card', async () => {
    const user = userEvent.setup();
    render(<AccountDialog onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Full name');
    await user.type(name, 'Reza Ahmadi');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('profile_save', expect.anything()));
    const [, args] = mocks.invoke.mock.calls.find(([command]) => command === 'profile_save')!;
    expect((args as { draft: { fullName: string } }).draft.fullName).toBe('Reza Ahmadi');
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  it('asks for the PIN when the vault exists but is locked', async () => {
    const user = userEvent.setup();
    render(<AccountDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('Vault is locked')).toBeInTheDocument();
    expect(screen.getByText('2 documents · 4 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('shows the setup form for a brand new vault', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'profile_get') return Promise.resolve(emptyProfile);
      if (command === 'vault_status') {
        return Promise.resolve({ initialized: false, unlocked: false, documentCount: 0, totalBytes: 0 });
      }
      if (command === 'sync_get_status') return Promise.resolve({ configured: false });
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const user = userEvent.setup();
    render(<AccountDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('Create the document vault')).toBeInTheDocument();
    expect(screen.getByText(/There is no recovery/)).toBeInTheDocument();
  });
});
