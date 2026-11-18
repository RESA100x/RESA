import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open, save } from '@tauri-apps/plugin-dialog';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { BackupPanel } from './BackupPanel';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const summary = { path: 'D:/backups/resa.resa', attachments: 3, byteSize: 2048, safetyCopy: null };

function renderPanel(repository: Partial<NowlyRepository>) {
  return render(
    <RepositoryProvider repository={repository as NowlyRepository}>
      <BackupPanel reload={() => undefined} />
    </RepositoryProvider>
  );
}

describe('BackupPanel', () => {
  beforeEach(() => {
    vi.mocked(save).mockReset();
    vi.mocked(open).mockReset();
  });

  it('writes the chosen path and reports the saved file', async () => {
    const user = userEvent.setup();
    vi.mocked(save).mockResolvedValue('D:/backups/resa.resa');
    const exportBackup = vi.fn().mockResolvedValue(summary);
    renderPanel({ exportBackup, importBackup: vi.fn() });

    await user.click(screen.getByRole('button', { name: /创建备份/ }));
    await waitFor(() => expect(exportBackup).toHaveBeenCalledWith('D:/backups/resa.resa'));
    expect(await screen.findByRole('status')).toHaveTextContent('D:/backups/resa.resa');
  });

  it('asks for confirmation before restoring and then reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue('D:/backups/resa.resa');
    const importBackup = vi.fn().mockResolvedValue({ ...summary, safetyCopy: 'D:/data/nowly.sqlite.pre-import' });
    renderPanel({ exportBackup: vi.fn(), importBackup });

    await user.click(screen.getByRole('button', { name: /还原备份/ }));
    expect(importBackup).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: /还原$/ });
    await user.click(confirm);
    await waitFor(() => expect(importBackup).toHaveBeenCalledWith('D:/backups/resa.resa'));
  });

  it('stays disabled when the repository cannot back up', () => {
    renderPanel({});
    expect(screen.getByRole('button', { name: /创建备份/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /还原备份/ })).toBeDisabled();
  });
});
