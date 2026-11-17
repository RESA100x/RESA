import { invoke } from '@tauri-apps/api/core';

// Both values come from the repository-root `resa.config.json` (see
// vite.config.ts). Keeping them out of the source means a build only ever
// points at its own project: an empty repository disables the update links
// instead of falling back to another project's releases.
const repo = typeof __RESA_REPO__ === 'string' ? __RESA_REPO__.trim() : '';

// The public repository used as a fallback for opening available updates.
export const FEEDBACK_REPO_URL = repo ? `https://github.com/${repo}` : '';

// The maintainer's contact email for feedback; hidden when unset.
export const FEEDBACK_EMAIL = typeof __RESA_FEEDBACK_EMAIL__ === 'string' ? __RESA_FEEDBACK_EMAIL__.trim() : '';

// Open an external https or mailto link in the OS default handler (browser or
// mail client). The backend validates the scheme before opening.
export async function openExternal(target: string): Promise<void> {
  await invoke('open_external', { target });
}
