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
  signedIn: false,
  lastSyncAt: null,
  pendingChanges: 0,
  deviceId: 'test-device'
};

describe('SyncPanel', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('asks for the server before showing the account form', async () => {
    vi.mocked(invoke).mockResolvedValue(baseStatus);
    render(<SyncPanel />);
    expect(await screen.findByText(t('sync.serverLegend'))).toBeInTheDocument();
    expect(screen.queryByText(t('sync.accountLegend'))).not.toBeInTheDocument();
  });

  it('shows the account form once a server is configured', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...baseStatus,
      configured: true,
      endpoint: 'https://demo.baas.arianet.app'
    });
    render(<SyncPanel />);
    expect(await screen.findByText(t('sync.accountLegend'))).toBeInTheDocument();
    expect(screen.queryByText(t('sync.serverLegend'))).not.toBeInTheDocument();
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
