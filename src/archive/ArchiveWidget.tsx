import { History } from '../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, t } from '../i18n';
import { useOptionalTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { ArchiveDialog } from './ArchiveDialog';
import { useTaskArchive } from './useTaskArchive';
import './archive.css';

/**
 * A one-cell launcher like the phone book and the report: the cell is the door,
 * the archive itself lives in the modal where a list and a history panel fit.
 */
export function ArchiveWidget({ readOnly = false, mobile = false }: { readOnly?: boolean; mobile?: boolean }) {
  const {
    archive,
    projects,
    contacts,
    reload,
    refresh,
    restore,
    restoreMany,
    setReason,
    purge,
    exportArchive,
    canExport,
    canAnnotate,
    canPurge
  } = useTaskArchive();
  // Restoring writes straight through the repository, so the board (kanban and
  // matrix) has to be told to re-read; otherwise a restored task lingers in the
  // done list until the next unrelated refresh.
  const taskWorkspace = useOptionalTaskWorkspace();
  const [open, setOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);

  // The tile is always on screen, so it has to follow the board instead of
  // waiting for a click: every task write changes this signature (status,
  // completion, archive or edit), and the archive re-reads itself quietly.
  const boardTasks = taskWorkspace?.workspace.data.tasks;
  const boardTags = taskWorkspace?.workspace.data.tags ?? [];
  const boardSignature = useMemo(
    () => boardTasks
      ? boardTasks.map((task) => `${task.id}:${task.status}:${task.completed ? 1 : 0}:${task.updatedAt}`).join('|')
      : '',
    [boardTasks]
  );
  const lastSignature = useRef(boardSignature);
  useEffect(() => {
    if (lastSignature.current === boardSignature) return;
    lastSignature.current = boardSignature;
    void refresh();
  }, [boardSignature, refresh]);

  const count = archive.data.length;
  const failed = archive.status === 'error';
  const ready = archive.status === 'ready';
  const detail = failed
    ? (archive.message ?? t('archive.readError'))
    : t('archive.tileDetail', { count: formatNumber(count) });

  const archivePage = (
    <ArchiveDialog
      inline={mobile}
      archive={archive}
      projects={projects}
      contacts={contacts.data}
      tags={boardTags}
      restoreFocusRef={tileRef}
      canAnnotate={canAnnotate}
      canPurge={canPurge}
      onRetry={reload}
      onRestore={async (id, status) => {
        await restore(id, status);
        await taskWorkspace?.refresh();
      }}
      onRestoreMany={async (ids, status) => {
        await restoreMany(ids, status);
        await taskWorkspace?.refresh();
      }}
      onSetReason={canAnnotate ? setReason : undefined}
      onPurge={canPurge ? purge : undefined}
      onExport={canExport ? exportArchive : undefined}
      onClose={() => setOpen(false)}
    />
  );

  if (mobile) {
    return <div className="widget-content archive-widget">{archivePage}</div>;
  }

  return (
    <div className="widget-content archive-widget">
      <button
        ref={tileRef}
        type="button"
        className="archive-tile"
        data-testid="archive-tile"
        disabled={readOnly}
        aria-label={
          readOnly
            ? t('archive.tileReadOnly', { count: formatNumber(count) })
            : t('archive.openTile', { count: formatNumber(count) })
        }
        title={detail}
        // The archive changes whenever a task is completed or deleted, so the
        // list is re-read on every open instead of trusting the mount snapshot.
        onClick={() => {
          setOpen(true);
          void reload();
        }}
      >
        <span className="archive-tile__plate" aria-hidden="true">
          <History />
        </span>
        <span className="archive-tile__badge" aria-hidden="true">
          {failed ? '!' : ready ? formatNumber(count) : '…'}
        </span>
      </button>

      {open ? archivePage : null}
    </div>
  );
}
