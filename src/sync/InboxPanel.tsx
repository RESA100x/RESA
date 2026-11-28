import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';
import { formatDisplayDate } from '../lib/calendar-system';
import type { Task, TaskEvent } from '../tasks/task-model';

type Mode = 'inbox' | 'outbox';

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('sync.failed');
}

const statusLabel = (status?: string) => t(`taskStatus.${status ?? 'open'}`);

// The delegation inbox.
//
// "My inbox" is what other people handed to me; "delegated by me" is what I
// handed out, with the activity on each so I can follow up without asking.
// Both read straight from the synced workspace, so they work on any device
// signed into the same account.
export function InboxPanel() {
  const [mode, setMode] = useState<Mode>('inbox');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await invoke<{ signedIn: boolean; userId: string | null }>('sync_get_status');
      setSignedIn(status.signedIn);
      setUserId(status.userId);
      if (!status.signedIn || !status.userId) {
        setTasks([]);
        return;
      }
      const command = mode === 'inbox' ? 'list_tasks_assigned_to' : 'list_tasks_delegated_by';
      const rows = await invoke<Task[]>(command, { userId: status.userId, archived: false });
      setTasks(Array.isArray(rows) ? rows : []);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(task: Task) {
    if (openId === task.id) {
      setOpenId(null);
      setEvents([]);
      return;
    }
    setOpenId(task.id);
    try {
      setEvents(await invoke<TaskEvent[]>('list_task_events', { taskId: task.id }));
    } catch (reason) {
      setError(message(reason));
    }
  }

  if (!signedIn) {
    return <p className="sync-panel__hint">{t('sync.optional')}</p>;
  }

  const empty = mode === 'inbox' ? t('sync.inboxEmpty') : t('sync.delegatedOutEmpty');

  return (
    <section className="delegation-panel" aria-label={t('sync.inbox')}>
      <div className="sync-switch" role="tablist" aria-label={t('sync.inbox')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'inbox'}
          className={mode === 'inbox' ? 'is-active' : undefined}
          onClick={() => setMode('inbox')}
        >
          {t('sync.inbox')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'outbox'}
          className={mode === 'outbox' ? 'is-active' : undefined}
          onClick={() => setMode('outbox')}
        >
          {t('sync.delegatedOut')}
        </button>
      </div>

      {loading ? <p className="sync-panel__hint">{t('sync.loading')}</p> : null}
      {!loading && tasks.length === 0 ? <p className="sync-panel__hint">{empty}</p> : null}

      <ul className="delegation-list">
        {tasks.map((task) => (
          <li key={task.id} className={openId === task.id ? 'is-open' : undefined}>
            <button type="button" className="delegation-row" onClick={() => void toggle(task)}>
              <span className={`delegation-dot delegation-dot--${task.status ?? 'open'}`} aria-hidden="true" />
              <span className="delegation-title">{task.title}</span>
              <span className="delegation-status">{statusLabel(task.status)}</span>
              {task.dueDate ? (
                <span className="delegation-due">
                  {formatDisplayDate(new Date(`${task.dueDate}T00:00:00`), 'short')}
                </span>
              ) : null}
            </button>
            {openId === task.id ? (
              <div className="delegation-detail">
                {task.description ? <p>{task.description}</p> : null}
                {mode === 'outbox' && task.assigneeUserId ? (
                  <p className="sync-panel__hint">
                    {t('sync.delegate')}: <code dir="ltr">{task.assigneeUserId.slice(0, 8)}</code>
                  </p>
                ) : null}
                <h5>{t('sync.timeline')}</h5>
                {events.length === 0 ? (
                  <p className="sync-panel__hint">—</p>
                ) : (
                  <ol className="delegation-timeline">
                    {events.map((event) => (
                      <li key={event.id}>
                        <span>{t(`taskEvent.${event.kind}`)}</span>
                        <time>{formatDisplayDate(new Date(event.at), 'short')}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    </section>
  );
}
