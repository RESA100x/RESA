import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { save } from '@tauri-apps/plugin-dialog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import { TaskWorkspaceProvider, useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import type { Task, TaskWorkspaceSnapshot } from '../tasks/task-model';
import { ReportsWidget } from './ReportsWidget';
import type { TaskReport } from './report-model';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

function report(overrides: Partial<TaskReport['totals']> = {}): TaskReport {
  return {
    days: [
      { date: '2026-11-14', created: 2, completed: 1, focusSeconds: 600 },
      { date: '2026-11-15', created: 0, completed: 1, focusSeconds: 300 }
    ],
    totals: {
      created: 2,
      completed: 2,
      open: 3,
      overdue: 1,
      archived: 0,
      completionRate: 0.4,
      averageCloseDays: 2,
      medianCloseDays: 2,
      ...overrides
    },
    quadrants: [
      { priority: 'important_urgent', open: 2, completed: 1 },
      { priority: 'not_important_not_urgent', open: 1, completed: 1 }
    ],
    lanes: [{ id: 'lane-1', name: 'فنی واجرایی', open: 2, completed: 2 }],
    projects: [
      { id: 'p1', name: 'پروژهٔ سایت', open: 2, completed: 1, overdue: 1, completionRate: 0.33, averageCloseDays: 3 }
    ],
    stuck: [
      {
        id: 't-old',
        title: 'کار قدیمی',
        status: 'open',
        priority: 'important_urgent',
        projectName: 'پروژهٔ سایت',
        dueDate: '2026-11-01',
        ageDays: 30,
        overdueDays: 12
      }
    ],
    meetings: [
      {
        id: 'm1',
        title: 'جلسهٔ هفتگی',
        startsAt: '2026-11-18T10:00',
        status: 'done',
        attendees: 3,
        present: 2,
        late: 1,
        absent: 0,
        excused: 0,
        unknown: 0,
        lateMinutes: 10,
        agendaItems: 2,
        agendaTasks: 1,
        agendaDone: 1
      }
    ],
    activity: [
      {
        id: 'e1',
        at: '2026-11-18T09:00:00.000Z',
        taskId: 't1',
        taskTitle: 'کار',
        kind: 'completed',
        detail: null
      }
    ],
    previous: { created: 1, completed: 1, archived: 0, averageCloseDays: 3 },
    generatedAt: '2026-11-19T08:00:00.000Z'
  };
}

function repository(data: TaskReport | Error) {
  return {
    getTaskReport: vi.fn(async () => {
      if (data instanceof Error) throw data;
      return data;
    })
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository) {
  return render(
    <RepositoryProvider repository={repo}>
      <ReportsWidget />
    </RepositoryProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

const emptySnapshot: TaskWorkspaceSnapshot = {
  lanes: [],
  tasks: [],
  tags: [],
  defaultLaneId: null,
  viewPreferences: {}
};

function task(overrides: Partial<Task> = {}): Task {
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
    projectId: null,
    archivedAt: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides
  };
}

function BoardProbe() {
  const workspace = useTaskWorkspace();
  return (
    <button type="button" onClick={() => void workspace.createTask({ ...task(), title: 'کار تازه' })}>
      add
    </button>
  );
}

describe('reports widget', () => {
  it('shows the open count on the tile and opens the report on click', async () => {
    const user = userEvent.setup();
    renderWidget(repository(report()));

    const tile = await screen.findByTestId('reports-tile');
    await waitFor(() => expect(tile.getAttribute('aria-label')).toBe(t('reports.openTile', { open: '3' })));
    expect(within(tile).getByText('3')).toBeTruthy();

    await user.click(tile);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t('reports.title'))).toBeTruthy();
    expect(within(dialog).getAllByText(t('reports.created')).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(t('reports.overdue')).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('فنی واجرایی')).toBeTruthy();
    expect(within(dialog).getByText(t('quadrant.important_urgent'))).toBeTruthy();
  });

  it('asks the repository for the chosen range', async () => {
    const user = userEvent.setup();
    const repo = repository(report());
    renderWidget(repo);

    await user.click(await screen.findByTestId('reports-tile'));
    const dialog = await screen.findByRole('dialog');
    expect(repo.getTaskReport).toHaveBeenCalledWith(30);

    await user.click(within(dialog).getByRole('button', { name: t('reports.range.90') }));
    await waitFor(() => expect(repo.getTaskReport).toHaveBeenCalledWith(90));
  });

  it('reports a failed read and retries from the dialog', async () => {
    const user = userEvent.setup();
    const repo = repository(new Error('boom'));
    renderWidget(repo);

    const tile = await screen.findByTestId('reports-tile');
    await waitFor(() => expect(within(tile).getByText('!')).toBeTruthy());
    await user.click(tile);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toContain('boom');
    // Opening the dialog already re-reads once, so the retry is one more call
    // on top of whatever the open did.
    const read = repo.getTaskReport as unknown as ReturnType<typeof vi.fn>;
    const before = read.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: t('reports.retry') }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(before + 1));
  });

  it('re-reads the report when the board changes underneath it', async () => {
    const user = userEvent.setup();
    const repo = {
      ...repository(report()),
      getTaskWorkspaceSnapshot: vi.fn(async () => emptySnapshot),
      createWorkspaceTask: vi.fn(async () => task({ id: 't-new', title: 'کار تازه' }))
    } as unknown as NowlyRepository;
    render(
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>
          <ReportsWidget />
          <BoardProbe />
        </TaskWorkspaceProvider>
      </RepositoryProvider>
    );
    const tile = await screen.findByTestId('reports-tile');
    await waitFor(() => expect(tile.getAttribute('aria-label')).toBe(t('reports.openTile', { open: '3' })));
    const read = repo.getTaskReport as unknown as ReturnType<typeof vi.fn>;
    const before = read.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows projects, stuck work, meetings and activity on their own tabs', async () => {
    const user = userEvent.setup();
    renderWidget(repository(report()));

    await user.click(await screen.findByTestId('reports-tile'));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('tab', { name: t('reports.tab.projects') }));
    expect(within(dialog).getByText('پروژهٔ سایت')).toBeTruthy();

    await user.click(within(dialog).getByRole('tab', { name: new RegExp(t('reports.tab.stuck')) }));
    expect(within(dialog).getByText('کار قدیمی')).toBeTruthy();
    expect(within(dialog).getByText(t('reports.stuckOverdue', { value: '12' }))).toBeTruthy();

    await user.click(within(dialog).getByRole('tab', { name: t('reports.tab.meetings') }));
    expect(within(dialog).getByText('جلسهٔ هفتگی')).toBeTruthy();
    expect(
      within(dialog).getByText(t('reports.meetingAttendance', { present: '2', late: '1', absent: '0' }))
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('tab', { name: t('reports.tab.activity') }));
    expect(within(dialog).getByText(t('reports.activityKind.completed'))).toBeTruthy();
  });

  it('exports the report through the repository', async () => {
    const user = userEvent.setup();
    const exportTaskReport = vi.fn(async (path: string, _days: number) => ({ path, format: 'csv' }));
    const repo = { ...repository(report()), exportTaskReport } as unknown as NowlyRepository;
    vi.mocked(save).mockResolvedValue('C:/tmp/report.csv');
    renderWidget(repo);

    await user.click(await screen.findByTestId('reports-tile'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: t('reports.export') }));

    await waitFor(() => expect(exportTaskReport).toHaveBeenCalled());
    expect(exportTaskReport.mock.calls[0][1]).toBe(30);
  });
});
