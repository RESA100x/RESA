import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type TeamMember = {
  userId: string;
  role: string;
  displayName: string | null;
};

type TeamState = {
  signedIn: boolean;
  userId: string | null;
  workspaceId: string | null;
  members: TeamMember[];
};

const empty: TeamState = { signedIn: false, userId: null, workspaceId: null, members: [] };

// Who is in the current workspace, for the delegate picker.
//
// It quietly does nothing when the app is offline or the account is signed
// out: a solo workspace keeps using the phone-book assignee and never sees a
// second person to hand work to.
export function useTeamMembers(): TeamState {
  const [state, setState] = useState<TeamState>(empty);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await invoke<{
          signedIn: boolean;
          userId: string | null;
          workspaceId: string | null;
        }>('sync_get_status');
        if (!status.signedIn || !status.workspaceId) {
          if (!cancelled) setState(empty);
          return;
        }
        const members = await invoke<TeamMember[]>('sync_workspace_members');
        if (!cancelled) {
          setState({
            signedIn: true,
            userId: status.userId,
            workspaceId: status.workspaceId,
            members
          });
        }
      } catch {
        if (!cancelled) setState(empty);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
