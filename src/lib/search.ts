export type SearchHitKind = 'event' | 'task' | 'note';

// One row of the global search behind the command palette. `date` is the
// event start, task due date or note update time, shown as a hint.
export type SearchHit = {
  kind: SearchHitKind;
  id: string;
  title: string;
  snippet: string;
  date: string | null;
};
