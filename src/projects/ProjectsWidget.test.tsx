import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import type { Project } from './project-model';
import { ProjectsWidget } from './ProjectsWidget';

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p1',
    name: 'عتبات',
    description: '',
    color: '#4FC9DA',
    status: 'active',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    archivedAt: null,
    taskCount: 3,
    ...overrides
  };
}

function repository(rows: Project[]) {
  return {
    listProjects: vi.fn(async () => rows),
    createProject: vi.fn(async (draft: { name: string }) => project({ id: 'new', name: draft.name, taskCount: 0 })),
    updateProject: vi.fn(async (id: string, draft: { name: string }) => project({ id, name: draft.name })),
    archiveProject: vi.fn(async () => undefined)
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository) {
  return render(
    <RepositoryProvider repository={repo}>
      <ProjectsWidget />
    </RepositoryProvider>
  );
}

describe('ProjectsWidget', () => {
  it('counts only active projects on the tile', async () => {
    renderWidget(repository([project({ id: 'a' }), project({ id: 'b', archivedAt: '2026-11-02T08:00:00.000Z' })]));
    const tile = await screen.findByTestId('projects-tile');
    expect(within(tile).getByText('1')).toBeInTheDocument();
  });

  it('lists projects with their task counts and archives one', async () => {
    const user = userEvent.setup();
    const repo = repository([project({ id: 'a', name: 'عتبات', taskCount: 4 })]);
    renderWidget(repo);
    await user.click(await screen.findByTestId('projects-tile'));

    const list = await screen.findByTestId('project-list');
    expect(within(list).getByText('عتبات')).toBeInTheDocument();
    expect(within(list).getByText(t('projects.tasks', { count: '4' }))).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: t('projects.archive') }));
    const confirm = await screen.findByText(t('projects.archiveTitle', { name: 'عتبات' }));
    await user.click(within(confirm.closest('.confirm-dialog') as HTMLElement).getByRole('button', { name: t('projects.archive') }));
    await waitFor(() => expect(repo.archiveProject).toHaveBeenCalledWith('a'));
  });

  it('creates a project from the dialog', async () => {
    const user = userEvent.setup();
    const repo = repository([]);
    renderWidget(repo);
    await user.click(await screen.findByTestId('projects-tile'));

    await user.click((await screen.findAllByRole('button', { name: t('projects.add') }))[0]);
    await user.type(screen.getByLabelText(t('projects.name')), 'پروژهٔ تازه');
    await user.click(screen.getByRole('button', { name: t('projects.save') }));

    await waitFor(() => expect(repo.createProject).toHaveBeenCalled());
  });
});
