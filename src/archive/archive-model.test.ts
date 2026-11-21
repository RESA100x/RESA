import { describe, expect, it } from 'vitest';
import type { Project } from '../projects/project-model';
import type { Task } from '../tasks/task-model';
import { archiveStats, archiveTabOf, closeDays, filterArchive, groupArchiveByMonth, projectName } from './archive-model';

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
    status: 'open',
    projectId: null,
    archivedAt: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    ...overrides
  };
}

describe('archive tabs', () => {
  it('puts each task in the tab it left the board from', () => {
    expect(archiveTabOf(task({ status: 'done', completed: true }))).toBe('done');
    expect(archiveTabOf(task({ status: 'suspended' }))).toBe('suspended');
    expect(archiveTabOf(task({ status: 'cancelled' }))).toBe('cancelled');
    // Archiving a finished task keeps it under "done"; only an open task that
    // was archived counts as a deletion.
    expect(archiveTabOf(task({ status: 'done', completed: true, archivedAt: '2026-11-03T08:00:00.000Z' }))).toBe('done');
    expect(archiveTabOf(task({ status: 'open', archivedAt: '2026-11-03T08:00:00.000Z' }))).toBe('deleted');
  });

  it('filters by tab, project and a case-insensitive query', () => {
    const rows = [
      task({ id: 'a', title: 'گزارش فروش', status: 'done', completed: true, projectId: 'p1' }),
      task({ id: 'b', title: 'تماس با مشتری', status: 'suspended', projectId: 'p2' }),
      task({ id: 'c', title: 'خرید لوازم', status: 'cancelled' })
    ];
    expect(filterArchive(rows, { tab: 'all', query: '', projectId: '' }).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(filterArchive(rows, { tab: 'done', query: '', projectId: '' }).map((row) => row.id)).toEqual(['a']);
    expect(filterArchive(rows, { tab: 'all', query: 'مشتری', projectId: '' }).map((row) => row.id)).toEqual(['b']);
    expect(filterArchive(rows, { tab: 'all', query: '', projectId: 'p1' }).map((row) => row.id)).toEqual(['a']);
  });
});

describe('project names', () => {
  it('resolves an id to the project name and tolerates unknown ids', () => {
    const projects = [{ id: 'p1', name: 'عتبات' }] as Project[];
    expect(projectName(projects, 'p1')).toBe('عتبات');
    expect(projectName(projects, 'missing')).toBe('');
    expect(projectName(projects, null)).toBe('');
  });
});

describe('archive filters', () => {
  it('narrows by assignee, tag and a date range', () => {
    const rows = [
      task({ id: 'a', status: 'done', completed: true, completedAt: '2026-11-10T08:00:00.000Z', assigneeContactId: 'c1', tagIds: ['t1'] }),
      task({ id: 'b', status: 'done', completed: true, completedAt: '2026-11-01T08:00:00.000Z', assigneeContactId: 'c2', tagIds: ['t2'] })
    ];
    const now = new Date(2026, 10, 20);
    expect(
      filterArchive(rows, { tab: 'all', query: '', projectId: '', assigneeId: 'c1', now }).map((row) => row.id)
    ).toEqual(['a']);
    expect(
      filterArchive(rows, { tab: 'all', query: '', projectId: '', tagId: 't2', now }).map((row) => row.id)
    ).toEqual(['b']);
    // The custom range keeps only the row inside [from, to].
    expect(
      filterArchive(rows, {
        tab: 'all',
        query: '',
        projectId: '',
        range: 'custom',
        from: '2026-11-05',
        to: '2026-11-30',
        now
      }).map((row) => row.id)
    ).toEqual(['a']);
  });

  it('matches the assignee name and the archive note in the search box', () => {
    const rows = [
      task({ id: 'a', status: 'cancelled', archiveReason: 'بودجه قطع شد', assigneeContactId: 'c1' }),
      task({ id: 'b', status: 'suspended' })
    ];
    const assigneeName = (id: string) => (id === 'c1' ? 'مریم رضایی' : '');
    expect(
      filterArchive(rows, { tab: 'all', query: 'بودجه', projectId: '', assigneeName }).map((row) => row.id)
    ).toEqual(['a']);
    expect(
      filterArchive(rows, { tab: 'all', query: 'مریم', projectId: '', assigneeName }).map((row) => row.id)
    ).toEqual(['a']);
  });
});

describe('archive groups and stats', () => {
  it('groups rows by the display month of their stamp', () => {
    const rows = [
      task({ id: 'a', status: 'done', completed: true, completedAt: '2026-11-10T08:00:00.000Z' }),
      task({ id: 'b', status: 'done', completed: true, completedAt: '2026-11-01T08:00:00.000Z' }),
      task({ id: 'c', status: 'done', completed: true, completedAt: '2026-09-02T08:00:00.000Z' })
    ];
    const groups = groupArchiveByMonth(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].tasks.map((row) => row.id)).toEqual(['a', 'b']);
    expect(groups[1].tasks.map((row) => row.id)).toEqual(['c']);
  });

  it('reports the average close time and the oldest unfinished item', () => {
    const rows = [
      task({
        id: 'a',
        status: 'done',
        completed: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        completedAt: '2026-11-03T00:00:00.000Z'
      }),
      task({ id: 'open-old', status: 'open', archivedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' }),
      task({ id: 'open-new', status: 'open', archivedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' })
    ];
    expect(closeDays(rows[0])).toBe(2);
    const stats = archiveStats(rows);
    expect(stats.total).toBe(3);
    expect(stats.averageCloseDays).toBe(2);
    expect(stats.oldestOpen?.id).toBe('open-old');
  });
});
