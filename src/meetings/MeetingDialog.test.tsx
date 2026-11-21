import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { emptyContactProfile, type Contact } from '../phonebook/contact-model';
import type { Task, TaskWorkspaceSnapshot } from '../tasks/task-model';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import { MeetingDialog } from './MeetingDialog';
import type { Meeting } from './meeting-model';

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: 'جلسه',
    agenda: '',
    minutes: '',
    location: '',
    startsAt: '2099-01-05T10:00',
    endsAt: '2099-01-05T11:00',
    status: 'planned',
    projectId: null,
    attendees: [],
    items: [],
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides
  };
}

function contact(id: string, name: string): Contact {
  return {
    id,
    name,
    nickname: '',
    personality: 'individual',
    roles: ['colleague'],
    isInternal: true,
    isFavorite: false,
    isActive: true,
    tags: [],
    photo: '',
    organization: '',
    jobTitle: '',
    companyName: '',
    phone: '',
    extension: '',
    email: '',
    address: '',
    birthday: '',
    categoryId: null,
    contractStatus: '',
    note: '',
    profile: emptyContactProfile(),
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z'
  };
}

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

const emptySnapshot: TaskWorkspaceSnapshot = {
  lanes: [],
  tasks: [],
  tags: [],
  defaultLaneId: null,
  viewPreferences: {}
};

function repository(meetings: Meeting[], contacts: Contact[] = []) {
  const repo = {
    listMeetings: vi.fn(async () => meetings),
    listContacts: vi.fn(async () => contacts),
    listProjects: vi.fn(async () => []),
    getTaskWorkspaceSnapshot: vi.fn(async () => emptySnapshot),
    saveMeeting: vi.fn(async (_id: string | null, draft: unknown) => ({ ...meeting(), ...(draft as object) })),
    createWorkspaceTask: vi.fn(async (draft: { title: string }) => task({ id: 't-new', title: draft.title })),
    setTaskAssignee: vi.fn(async (id: string, contactId: string | null) => task({ id, assigneeContactId: contactId })),
    setTaskProject: vi.fn(async (id: string, projectId: string | null) => task({ id, projectId }))
  };
  return repo as unknown as NowlyRepository & typeof repo;
}

function renderDialog(repo: NowlyRepository, meetingId: string | null = null) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>{children}</TaskWorkspaceProvider>
      </RepositoryProvider>
    );
  }
  const onClose = vi.fn();
  render(<MeetingDialog meetingId={meetingId} onClose={onClose} />, { wrapper: Wrapper });
  return { onClose };
}

describe('MeetingDialog', () => {
  it('saves a new meeting with its subject', async () => {
    const user = userEvent.setup();
    const repo = repository([]);
    const { onClose } = renderDialog(repo);
    await user.type(await screen.findByLabelText('主题'), 'جلسهٔ بودجه');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(repo.saveMeeting).toHaveBeenCalled());
    expect(repo.saveMeeting.mock.calls[0][0]).toBeNull();
    expect(repo.saveMeeting.mock.calls[0][1]).toMatchObject({ title: 'جلسهٔ بودجه' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses to save without a subject', async () => {
    const user = userEvent.setup();
    const repo = repository([]);
    renderDialog(repo);
    await user.click(await screen.findByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写会议主题。');
    expect(repo.saveMeeting).not.toHaveBeenCalled();
  });

  it('adds an attendee from the phone book', async () => {
    const user = userEvent.setup();
    renderDialog(repository([], [contact('c1', 'سارا')]));
    const picker = await screen.findByRole('combobox', { name: '添加参会人' });
    await user.click(picker);
    await user.click(screen.getByRole('option', { name: 'سارا' }));
    expect(await screen.findByText('سارا')).toBeInTheDocument();
  });

  it('turns an agenda item into a task and links it back', async () => {
    const user = userEvent.setup();
    const repo = repository([], [contact('c1', 'سارا')]);
    renderDialog(repo);
    await user.type(await screen.findByLabelText('主题'), 'جلسه');
    await user.click(screen.getByRole('button', { name: '添加议程事项' }));
    await user.type(screen.getByLabelText('议程事项'), 'ارسال گزارش');
    await user.click(screen.getByRole('button', { name: '转为任务' }));
    const dialog = await screen.findByRole('dialog', { name: '从事项创建任务' });
    await user.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(repo.createWorkspaceTask).toHaveBeenCalled());
    expect(repo.createWorkspaceTask.mock.calls[0][0]).toMatchObject({ title: 'ارسال گزارش' });
    await waitFor(() => expect(repo.saveMeeting).toHaveBeenCalled());
    const calls = repo.saveMeeting.mock.calls;
    const saved = calls[calls.length - 1][1] as { items: { taskId: string | null }[] };
    expect(saved.items[0].taskId).toBe('t-new');
  });
});
