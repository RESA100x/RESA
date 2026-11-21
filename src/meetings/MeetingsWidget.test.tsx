import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import type { TaskWorkspaceSnapshot } from '../tasks/task-model';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import { emptyContactProfile, type Contact } from '../phonebook/contact-model';
import { MeetingsWidget } from './MeetingsWidget';
import type { Meeting } from './meeting-model';

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: 'جلسهٔ هفتگی',
    agenda: '',
    minutes: '',
    location: 'اتاق ۲',
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

const emptySnapshot: TaskWorkspaceSnapshot = {
  lanes: [],
  tasks: [],
  tags: [],
  defaultLaneId: null,
  viewPreferences: {}
};

function repository(meetings: Meeting[], contacts: Contact[] = []): NowlyRepository {
  return {
    listMeetings: vi.fn(async () => meetings),
    listContacts: vi.fn(async () => contacts),
    listProjects: vi.fn(async () => []),
    getTaskWorkspaceSnapshot: vi.fn(async () => emptySnapshot),
    saveMeeting: vi.fn(async (_id: string | null, draft: unknown) => ({ ...meeting(), ...(draft as object) }))
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repo}>
        <TaskWorkspaceProvider>{children}</TaskWorkspaceProvider>
      </RepositoryProvider>
    );
  }
  return render(<MeetingsWidget />, { wrapper: Wrapper });
}

describe('MeetingsWidget', () => {
  it('counts only upcoming meetings on the tile', async () => {
    renderWidget(repository([
      meeting({ id: 'future' }),
      meeting({ id: 'past', startsAt: '2020-01-01T10:00', endsAt: '2020-01-01T11:00' })
    ]));
    const tile = await screen.findByTestId('meetings-tile');
    await waitFor(() => expect(within(tile).getByText('1')).toBeInTheDocument());
  });

  it('opens the schedule and lists meetings with their place', async () => {
    const user = userEvent.setup();
    renderWidget(repository([meeting()]));
    await user.click(await screen.findByTestId('meetings-tile'));
    expect(await screen.findByText('جلسهٔ هفتگی')).toBeInTheDocument();
    expect(screen.getByText('اتاق ۲')).toBeInTheDocument();
  });

  it('opens the editor for a new meeting', async () => {
    const user = userEvent.setup();
    renderWidget(repository([meeting()], [contact('c1', 'سارا')]));
    await user.click(await screen.findByTestId('meetings-tile'));
    await user.click(screen.getByRole('button', { name: '新建会议' }));
    expect(await screen.findByLabelText('主题')).toBeInTheDocument();
  });
});
