import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import type { Project } from '../projects/project-model';
import type { Task, TaskEvent } from '../tasks/task-model';
import { TaskWorkspaceProvider, useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { ArchiveWidget } from './ArchiveWidget';

function task(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'کار',
    description: '',
    priority: 'not_important_not_urgent',
    dueDate: null,
    completed: false,
    completedAt: null,
    laneId: null,
    boardPosition: 0,
    tagIds: [],
    steps: [],
    status: 'done',
    projectId: null,
    archivedAt: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    ...overrides
  };
}

function repository(options: { tasks?: Task[]; projects?: Project[]; events?: TaskEvent[] } = {}) {
  return {
    listTaskArchive: vi.fn(async () => options.tasks ?? []),
    listProjects: vi.fn(async () => options.projects ?? []),
    listTaskEvents: vi.fn(async () => options.events ?? []),
    setTaskStatus: vi.fn(async (id: string) => task({ id, status: 'open' })),
    setTaskArchiveReason: vi.fn(async (id: string, reason: string | null) => task({ id, archiveReason: reason })),
    purgeTasks: vi.fn(async (ids: string[]) => ids.length),
    exportTaskArchive: vi.fn(async (path: string) => ({ path, tasks: 1 }))
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository) {
  return render(
    <RepositoryProvider repository={repo}>
      <ArchiveWidget />
    </RepositoryProvider>
  );
}

describe('ArchiveWidget', () => {
  it('shows the archived count on a one-cell tile', async () => {
    renderWidget(repository({ tasks: [task({ id: 'a' }), task({ id: 'b' })] }));
    const tile = await screen.findByTestId('archive-tile');
    expect(within(tile).getByText('2')).toBeInTheDocument();
  });

  it('opens the archive, filters and shows the task history', async () => {
    const user = userEvent.setup();
    renderWidget(
      repository({
        tasks: [task({ id: 'a', title: 'گزارش فروش' }), task({ id: 'b', title: 'تماس', status: 'suspended' })],
        events: [
          { id: 'e1', taskId: 'a', kind: 'created', detail: null, at: '2026-11-01T08:00:00.000Z' },
          { id: 'e2', taskId: 'a', kind: 'completed', detail: null, at: '2026-11-02T08:00:00.000Z' }
        ]
      })
    );
    await user.click(await screen.findByTestId('archive-tile'));

    const list = await screen.findByTestId('archive-list');
    expect(within(list).getByText('گزارش فروش')).toBeInTheDocument();

    await user.click(within(list).getByText('گزارش فروش'));
    const detail = await screen.findByTestId('archive-detail');
    await waitFor(() => expect(within(detail).getByText(t('taskEvent.created'))).toBeInTheDocument());
    expect(within(detail).getAllByText(t('taskEvent.completed')).length).toBeGreaterThan(0);
  });

  it('narrows the list with the search box', async () => {
    const user = userEvent.setup();
    renderWidget(
      repository({
        tasks: [task({ id: 'a', title: 'گزارش فروش' }), task({ id: 'b', title: 'تماس با مشتری' })]
      })
    );
    await user.click(await screen.findByTestId('archive-tile'));
    const list = await screen.findByTestId('archive-list');

    await user.type(screen.getByLabelText(t('archive.search')), 'مشتری');
    expect(within(list).queryByText('گزارش فروش')).not.toBeInTheDocument();
    expect(within(list).getByText('تماس با مشتری')).toBeInTheDocument();
  });

  it('follows the board and refreshes the tile without a click', async () => {
    const open = task({ id: 't1', status: 'open', completed: false });
    const done = { ...open, status: 'done' as const, completed: true, completedAt: '2026-11-03T08:00:00.000Z' };
    let archiveRows: Task[] = [];
    const repo = {
      getTaskWorkspaceSnapshot: vi.fn(async () => ({
        tasks: [open],
        lanes: [],
        tags: [],
        defaultLaneId: null,
        viewPreferences: {}
      })),
      listTaskArchive: vi.fn(async () => archiveRows),
      listProjects: vi.fn(async () => []),
      listTaskEvents: vi.fn(async () => []),
      setWorkspaceTaskCompleted: vi.fn(async () => done)
    } as unknown as NowlyRepository;

    let api: ReturnType<typeof useTaskWorkspace> | null = null;
    function Capture() {
      api = useTaskWorkspace();
      return null;
    }

    render(
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>
          <Capture />
          <ArchiveWidget />
        </TaskWorkspaceProvider>
      </RepositoryProvider>
    );

    const tile = await screen.findByTestId('archive-tile');
    await waitFor(() => expect(within(tile).getByText('0')).toBeInTheDocument());

    // Completing a task puts it in the archive; the tile must follow on its own.
    archiveRows = [done];
    await act(async () => {
      await api!.setTaskCompleted('t1', true);
    });

    await waitFor(() => expect(within(tile).getByText('1')).toBeInTheDocument());
  });

  it('saves the archive note from the detail pane', async () => {
    const user = userEvent.setup();
    const repo = repository({ tasks: [task({ id: 'a', title: 'قرارداد' })] });
    renderWidget(repo);
    await user.click(await screen.findByTestId('archive-tile'));
    await user.click(within(await screen.findByTestId('archive-list')).getByText('قرارداد'));

    const detail = await screen.findByTestId('archive-detail');
    const box = within(detail).getByLabelText(t('archive.reason'));
    await user.type(box, 'مشتری منصرف شد');
    await user.click(within(detail).getByRole('button', { name: t('archive.saveReason') }));

    await waitFor(() =>
      expect(repo.setTaskArchiveReason).toHaveBeenCalledWith('a', 'مشتری منصرف شد')
    );
  });

  it('restores every selected row in one action', async () => {
    const user = userEvent.setup();
    const repo = repository({
      tasks: [task({ id: 'a', title: 'الف' }), task({ id: 'b', title: 'ب' })]
    });
    renderWidget(repo);
    await user.click(await screen.findByTestId('archive-tile'));
    await screen.findByTestId('archive-list');

    await user.click(screen.getByLabelText(t('archive.selectAll')));
    await user.click(screen.getByRole('button', { name: t('archive.restoreSelected') }));

    await waitFor(() => expect(repo.setTaskStatus).toHaveBeenCalledTimes(2));
  });

  it('requires an explicit acknowledgement before a permanent delete', async () => {
    const user = userEvent.setup();
    const repo = repository({ tasks: [task({ id: 'a', title: 'بایگانی‌شده' })] });
    renderWidget(repo);
    await user.click(await screen.findByTestId('archive-tile'));
    await user.click(within(await screen.findByTestId('archive-list')).getByText('بایگانی‌شده'));

    const detail = await screen.findByTestId('archive-detail');
    await user.click(within(detail).getByRole('button', { name: t('archive.deletePermanently') }));

    const dialogs = await screen.findAllByRole('dialog');
    const confirm = dialogs[dialogs.length - 1];
    const confirmButton = within(confirm).getByRole('button', { name: t('archive.deletePermanently') });
    expect(confirmButton).toBeDisabled();

    await user.click(within(confirm).getByLabelText(t('archive.confirmPurgeAcknowledge')));
    await user.click(confirmButton);

    await waitFor(() => expect(repo.purgeTasks).toHaveBeenCalledWith(['a']));
  });
});
