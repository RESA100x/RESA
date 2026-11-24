import { FolderOpen } from '../components/icons';
import { useRef, useState } from 'react';
import { formatNumber, t } from '../i18n';
import { ProjectsDialog } from './ProjectsDialog';
import { useProjects } from './useProjects';
import './projects.css';

// The projects launcher: one cell, the folder glyph, the active project count.
// The list and its history live in the modal.
export function ProjectsWidget({ readOnly = false, mobile = false }: { readOnly?: boolean; mobile?: boolean }) {
  const { projects, reload, createProject, updateProject, archiveProject, restoreProject } = useProjects();
  const [open, setOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);

  const activeCount = projects.data.filter((project) => !project.archivedAt).length;
  const failed = projects.status === 'error';
  const ready = projects.status === 'ready';
  const detail = failed
    ? (projects.message ?? t('projects.readError'))
    : t('projects.tileDetail', { count: formatNumber(activeCount) });

  const list = (
    <ProjectsDialog
      inline={mobile}
      resource={projects}
      restoreFocusRef={tileRef}
      onRetry={reload}
      onClose={() => setOpen(false)}
      onCreate={createProject}
      onUpdate={(project, draft) => updateProject(project.id, draft)}
      onArchive={archiveProject}
      onRestore={restoreProject}
    />
  );

  if (mobile) {
    return <div className="widget-content projects-widget">{list}</div>;
  }

  return (
    <div className="widget-content projects-widget">
      <button
        ref={tileRef}
        type="button"
        className="projects-tile"
        data-testid="projects-tile"
        disabled={readOnly}
        aria-label={
          readOnly
            ? t('projects.tileReadOnly', { count: formatNumber(activeCount) })
            : t('projects.openTile', { count: formatNumber(activeCount) })
        }
        title={detail}
        onClick={() => {
          setOpen(true);
          void reload();
        }}
      >
        <span className="projects-tile__plate" aria-hidden="true">
          <FolderOpen />
        </span>
        <span className="projects-tile__badge" aria-hidden="true">
          {failed ? '!' : ready ? formatNumber(activeCount) : '…'}
        </span>
      </button>

      {open ? list : null}
    </div>
  );
}
