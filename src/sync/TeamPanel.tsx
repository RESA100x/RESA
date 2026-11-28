import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
  memberCount: number;
};

export type WorkspaceMember = {
  userId: string;
  role: string;
  displayName: string | null;
  email: string | null;
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('sync.failed');
}

const roleLabel = (role: string) =>
  role === 'owner' ? t('sync.roleOwner') : role === 'manager' ? t('sync.roleManager') : t('sync.roleMember');

// The team half of the account screen.
//
// A personal account always owns one workspace and never needs this. It only
// becomes useful the moment a second person joins, because then everyone is
// reading and writing the same records: a task handed to someone shows up in
// their own app, and the person who handed it over can follow it.
export function TeamPanel({ signedIn }: { signedIn: boolean }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'manager'>('member');
  const [inviteToken, setInviteToken] = useState('');
  const [acceptToken, setAcceptToken] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const list = await invoke<WorkspaceSummary[]>('sync_workspace_list');
      // Defensive: a backend hiccup must not blank the whole account screen.
      setWorkspaces(Array.isArray(list) ? list : []);
      const status = await invoke<{ workspaceId: string | null }>('sync_get_status');
      setCurrent(status.workspaceId ?? (Array.isArray(list) ? list[0]?.id : null) ?? null);
      const people = await invoke<WorkspaceMember[]>('sync_workspace_members');
      setMembers(Array.isArray(people) ? people : []);
    } catch (reason) {
      setError(message(reason));
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
      if (success) setNotice(success);
      await refresh();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  if (!signedIn) return null;

  const active = workspaces.find((workspace) => workspace.id === current) ?? null;
  const canInvite = active?.role === 'owner' || active?.role === 'manager';

  return (
    <section className="sync-team" aria-label={t('sync.team')}>
      <header className="sync-team__head">
        <div>
          <h4>{t('sync.team')}</h4>
          <p className="sync-panel__hint">{t('sync.teamHint')}</p>
        </div>
      </header>

      {workspaces.length > 1 ? (
        <label className="sync-field">
          <span>{t('sync.workspace')}</span>
          <select
            value={current ?? ''}
            disabled={busy !== null}
            onChange={(event) =>
              void run('switch', () => invoke('sync_workspace_switch', { workspaceId: event.target.value }), t('sync.workspaceSwitched'))
            }
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} · {roleLabel(workspace.role)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="sync-team__current">
          <strong>{active?.name ?? t('sync.workspace')}</strong>
          <span>{active ? roleLabel(active.role) : ''}</span>
        </p>
      )}

      <ul className="sync-team__members">
        {members.map((member) => (
          <li key={member.userId}>
            <span className="sync-team__avatar" aria-hidden="true">
              {(member.displayName ?? member.userId).slice(0, 1).toUpperCase()}
            </span>
            <span className="sync-team__name">{member.displayName ?? member.userId.slice(0, 8)}</span>
            <span className="sync-team__role">{roleLabel(member.role)}</span>
          </li>
        ))}
      </ul>

      {canInvite ? (
        <div className="sync-team__invite">
          <label className="sync-field">
            <span>{t('sync.inviteEmail')}</span>
            <input
              dir="ltr"
              type="email"
              value={inviteEmail}
              placeholder="teammate@example.com"
              disabled={busy !== null}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>{t('sync.inviteRole')}</span>
            <select
              value={inviteRole}
              disabled={busy !== null}
              onChange={(event) => setInviteRole(event.target.value as 'member' | 'manager')}
            >
              <option value="member">{t('sync.roleMember')}</option>
              <option value="manager">{t('sync.roleManager')}</option>
            </select>
          </label>
          <button
            type="button"
            className="good-button good-button--primary"
            disabled={busy !== null || !inviteEmail.trim()}
            onClick={() =>
              void run(
                'invite',
                async () => {
                  const token = await invoke<string>('sync_workspace_invite', { email: inviteEmail, role: inviteRole });
                  setInviteToken(token);
                  setInviteEmail('');
                },
                t('sync.inviteCreated')
              )
            }
          >
            {busy === 'invite' ? t('sync.working') : t('sync.invite')}
          </button>
          {inviteToken ? (
            <div className="sync-team__token">
              <span>{t('sync.inviteToken')}</span>
              <code dir="ltr">{inviteToken}</code>
              <button
                type="button"
                className="sync-link"
                onClick={() => void navigator.clipboard?.writeText(inviteToken).then(() => setNotice(t('sync.copied')))}
              >
                {t('sync.copyToken')}
              </button>
              <p className="sync-panel__hint">{t('sync.inviteTokenHint')}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sync-team__accept">
        <label className="sync-field">
          <span>{t('sync.acceptInvite')}</span>
          <input
            dir="ltr"
            value={acceptToken}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={busy !== null}
            onChange={(event) => setAcceptToken(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="good-button"
          disabled={busy !== null || acceptToken.trim().length < 8}
          onClick={() =>
            void run(
              'accept',
              async () => {
                await invoke('sync_workspace_accept', { token: acceptToken.trim() });
                setAcceptToken('');
              },
              t('sync.accepted')
            )
          }
        >
          {busy === 'accept' ? t('sync.working') : t('sync.acceptButton')}
        </button>
      </div>

      <details className="sync-team__create">
        <summary>{t('sync.createWorkspace')}</summary>
        <label className="sync-field">
          <span>{t('sync.workspaceName')}</span>
          <input
            value={newName}
            disabled={busy !== null}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="good-button"
          disabled={busy !== null || !newName.trim()}
          onClick={() =>
            void run(
              'create',
              async () => {
                await invoke('sync_workspace_create', { name: newName.trim() });
                setNewName('');
              },
              t('sync.workspaceCreated')
            )
          }
        >
          {busy === 'create' ? t('sync.working') : t('sync.createButton')}
        </button>
      </details>

      {notice ? <p className="sync-panel__status" role="status">{notice}</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    </section>
  );
}
