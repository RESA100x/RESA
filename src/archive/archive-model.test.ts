import { describe, expect, it } from 'vitest';
import type { Project } from '../projects/project-model';
import type { Task } from '../tasks/task-model';
import { archiveTabOf, filterArchive, projectName } from './archive-model';

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
