import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';
import { SyncPanel } from './SyncPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const baseStatus = {
  configured: false,
  enabled: false,
  endpoint: null,
  email: null,
  phone: null,
  signedIn: false,
  lastSyncAt: null,
  pendingChanges: 0,
  deviceId: 'test-device',
  hasDefaults: false
};

describe('SyncPanel', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('shows the sign-in form even before a server is configured', async () => {
    vi.mocked(invoke).mockResolvedValue(baseStatus);
    render(<SyncPanel />);

    expect(await screen.findByLabelText(t('sync.email'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('sync.password'))).toBeInTheDocument();
    expect(screen.getByText(t('sync.needServer'))).toBeInTheDocument();
  });

  it('applies the build server settings instead of asking the user for them', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'sync_apply_defaults') {
        return Promise.resolve({
          ...baseStatus,
          configured: true,
          endpoint: 'https://demo.baas.arianet.app',
          hasDefaults: true
        });
      }
      return Promise.resolve({ ...baseStatus, hasDefaults: true });
    });
    render(<SyncPanel />);

    expect(await screen.findByLabelText(t('sync.email'))).toBeInTheDocument();
    expect(screen.queryByText(t('sync.needServer'))).not.toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'sync_apply_defaults')).toBe(true);
  });

  it('never exposes server addresses or keys to the person using the app', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...baseStatus, configured: true });
    render(<SyncPanel />);

    expect(await screen.findByLabelText(t('sync.email'))).toBeInTheDocument();
    expect(screen.queryByText(t('sync.advanced'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t('sync.endpoint'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t('sync.anonKey'))).not.toBeInTheDocument();
  });

  it('shows the sync controls for a signed-in session', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...baseStatus,
      configured: true,
      signedIn: true,
      enabled: true,
      endpoint: 'https://demo.baas.arianet.app',
      email: 'user@example.com',
      pendingChanges: 3
    });
    render(<SyncPanel />);

    expect(await screen.findByRole('button', { name: t('sync.syncNow') })).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: t('sync.autoSync') })).toBeChecked();
  });
});
