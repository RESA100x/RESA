import type { HexColor } from '../lib/color';
import type { Recurrence } from '../calendar/calendar-model';

export type TaskPriority =
  | 'important_urgent'
  | 'important_not_urgent'
  | 'not_important_urgent'
  | 'not_important_not_urgent';

// The lifecycle of a task. `done` is the only state that also sets
// `completed`; suspended and cancelled leave the board without being finished.
export const TASK_STATUSES = [
  'open',
  'in_progress',
  'done',
  'suspended',
  'cancelled',
  'delayed'
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = 'open';

// Statuses that keep a task on the board; the rest live in the archive.
export const BOARD_STATUSES: TaskStatus[] = ['open', 'in_progress', 'delayed'];

export function taskStatus(task: { status?: TaskStatus; completed?: boolean }): TaskStatus {
  if (task.status) return task.status;
  return task.completed ? 'done' : 'open';
}

export type TaskStep = {
  id: string;
  title: string;
  completed: boolean;
};

// `id` is null for a step that has not been saved yet.
export type TaskStepDraft = {
  id: string | null;
  title: string;
  completed: boolean;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  completed: boolean;
  // When the task was last completed; null while it is open.
  completedAt: string | null;
  // null keeps the task off the kanban board (tasks created from the matrix).
  // A completed task keeps its lane so reopening returns it there.
  laneId: string | null;
  boardPosition: number;
  tagIds: string[];
  steps: TaskStep[];
  // Recurring tasks keep one row per occurrence; the rule is copied onto each.
  recurrence?: Recurrence | null;
  // The series root's id; null on the first occurrence.
  recurrenceParentId?: string | null;
  // Lifecycle state; older rows carry only `completed`.
  status?: TaskStatus;
  // The project this task belongs to, if any.
  projectId?: string | null;
  // Set when the task was deleted from the board; it stays readable in the archive.
  archivedAt?: string | null;
  // The phone-book contact this task is assigned to, if any.
  assigneeContactId?: string | null;
  // The one-line note explaining why the task left the board; written from the archive.
  archiveReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  kind: string;
  detail: string | null;
  at: string;
};

export type TaskDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  completed: boolean;
  laneId: string | null;
  tagIds: string[];
  // Omitted keeps the stored steps; a list replaces them in order.
  steps?: TaskStepDraft[];
};

export type TaskLane = {
  id: string;
  name: string;
  color: HexColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskLaneDraft = Pick<TaskLane, 'name' | 'color'>;

export type TaskTag = {
  id: string;
  name: string;
  color: HexColor;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskTagDraft = Pick<TaskTag, 'name' | 'color'>;

export type TaskViewPreferences = Record<string, unknown>;

export type TaskWorkspaceSnapshot = {
  tasks: Task[];
  lanes: TaskLane[];
  tags: TaskTag[];
  // null until the user creates a lane.
  defaultLaneId: string | null;
  viewPreferences: TaskViewPreferences;
};

export const taskPriorityOrder: TaskPriority[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent'
];

export const defaultTaskPriority: TaskPriority = 'not_important_not_urgent';

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && taskPriorityOrder.includes(value as TaskPriority);
}

export function emptyTaskWorkspace(): TaskWorkspaceSnapshot {
  return {
    tasks: [],
    lanes: [],
    tags: [],
    defaultLaneId: null,
    viewPreferences: {}
  };
}

export function sortTaskWorkspace(snapshot: TaskWorkspaceSnapshot): TaskWorkspaceSnapshot {
  const lanes = [...snapshot.lanes].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const laneOrder = new Map(lanes.map((lane, index) => [lane.id, index]));
  const tasks = [...snapshot.tasks].sort(
    (a, b) =>
      (laneOrder.get(a.laneId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (laneOrder.get(b.laneId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      a.boardPosition - b.boardPosition ||
      a.id.localeCompare(b.id)
  );
  const tags = [...snapshot.tags].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { ...snapshot, tasks, lanes, tags };
}

export function stepProgress(steps: readonly Pick<TaskStep, 'completed'>[] | undefined) {
  const list = steps ?? [];
  return { done: list.filter((step) => step.completed).length, total: list.length };
}

// Snapshots from older builds, the website showcase and test doubles may lack
// steps or a quadrant.
export function normalizeTaskWorkspace(snapshot: TaskWorkspaceSnapshot): TaskWorkspaceSnapshot {
  return {
    ...snapshot,
    defaultLaneId: snapshot.defaultLaneId ?? null,
    tasks: snapshot.tasks.map((task) =>
      Array.isArray(task.steps) &&
      isTaskPriority(task.priority) &&
      task.completedAt !== undefined &&
      task.recurrence !== undefined &&
      task.recurrenceParentId !== undefined
        ? task
        : {
            ...task,
            steps: Array.isArray(task.steps) ? task.steps : [],
            priority: isTaskPriority(task.priority) ? task.priority : defaultTaskPriority,
            completedAt: task.completedAt ?? null,
            recurrence: task.recurrence ?? null,
            recurrenceParentId: task.recurrenceParentId ?? null
          }
    )
  };
}
