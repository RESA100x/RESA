import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Task } from '../tasks/task-model';
import type { Note } from '../notes/notes-model';

export type ModalState =
  | { type: 'date'; isoDate: string; trigger: HTMLElement | null }
  | { type: 'event-create'; dateIso: string; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'event-edit'; event: CalendarEvent; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'task-create'; dueDate: string | null; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'task-edit'; task: MatrixTask; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'workspace-task-edit'; task: Task; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'note-create'; trigger: HTMLElement | null; parentManager?: boolean }
  | { type: 'note-edit'; note: Note; trigger: HTMLElement | null; parentManager?: boolean }
  | { type: 'notes-manager'; trigger: HTMLElement | null }
  | { type: 'settings'; trigger: HTMLElement | null }
  | { type: 'external-detail'; event: CalendarEvent; trigger: HTMLElement | null }
  | { type: 'calendar-settings'; trigger: HTMLElement | null }
  | { type: 'task-settings'; trigger: HTMLElement | null }
  | { type: 'meeting-edit'; meetingId: string | null; trigger: HTMLElement | null }
  | { type: 'contact-card'; contactId: string; trigger: HTMLElement | null }
  | { type: 'book-card'; bookId: string; trigger: HTMLElement | null }
  | { type: 'task-open'; taskId: string; trigger: HTMLElement | null }
  | null;

// A few modules (the phone-book block, for one) sit outside the app shell and
// cannot reach `setModal`. They register nothing and instead ask the shell to
// open something on their behalf, so a contact card can jump to a task or a
// meeting without the block owning the modal state.
let modalRequestHandler: ((modal: ModalState) => void) | null = null;

export function registerModalRequest(handler: (modal: ModalState) => void) {
  modalRequestHandler = handler;
  return () => {
    if (modalRequestHandler === handler) modalRequestHandler = null;
  };
}

export function requestModal(modal: ModalState) {
  modalRequestHandler?.(modal);
}
