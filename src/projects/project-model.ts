import type { HexColor } from '../lib/color';

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Project = {
  id: string;
  name: string;
  description: string;
  color: HexColor;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  // Tasks ever attached to the project, archived ones included.
  taskCount?: number;
};

export type ProjectDraft = {
  name: string;
  description?: string;
  color?: HexColor;
  status?: ProjectStatus;
};

export const DEFAULT_PROJECT_COLOR: HexColor = '#4FC9DA';

export function projectStatusLabel(status: ProjectStatus) {
  return `projectStatus.${status}`;
}
