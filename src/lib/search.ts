export type SearchHitKind = 'event' | 'task' | 'note' | 'contact';

// One row of the global search behind the command palette. `date` is the
// event start, task due date, note update time or a contact's birthday, and is
// shown as a hint only.
export type SearchHit = {
  kind: SearchHitKind;
  id: string;
  title: string;
  snippet: string;
  date: string | null;
};
