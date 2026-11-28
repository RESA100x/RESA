import { CalendarDays, Paperclip, UserCircle } from '../components/icons';
import type { DragEvent } from 'react';
import { contentAttachments } from '../components/rich-text/content';
import type { ResolvedCard } from './kanban-view';
import { formatDueDate, isOverdue } from './kanban-view';
import { t } from '../i18n';
import { TaskStepCount } from '../tasks/TaskStepCount';
import { stepProgress, taskStatus, type TaskStatus } from '../tasks/task-model';
import { ActionMenu } from '../components/ActionMenu';

type KanbanCardProps = {
  resolved: ResolvedCard;
  todayIso: string;
  dragging?: boolean;
  onOpen: () => void;
  // Moves the task out of "open" without opening the full form: done,
  // suspended, cancelled or delayed.
  onStatusChange?: (status: TaskStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  // Resolved once by the board from the phone book, so a card never fetches
  // contacts by itself.
  assigneeName?: string;
};

// The states a card can move to from the board. "open" is the way back, so a
// card that was suspended by mistake does not need the task form.
const CARD_STATUSES: TaskStatus[] = ['open', 'in_progress', 'done', 'suspended', 'cancelled', 'delayed'];

// A task card: a quadrant dot and the title, then one meta line that only
// renders the fields the task actually has. The card body drags; the title
// button opens the editor.
export function KanbanCard({
  resolved,
  todayIso,
  dragging = false,
  onOpen,
  onStatusChange,
  onDragStart,
  onDragEnd,
  assigneeName
}: KanbanCardProps) {
  const { card, priority, tags } = resolved;
  const status = taskStatus(card);

  // Counting attachments is a pure content parse, so a card costs no IO to show
  // its paperclip. Files only: an inline image is content, not an attachment.
  const { fileIds } = card.description
    ? contentAttachments(card.description)
    : { fileIds: [] };
  const attachmentCount = fileIds.length;
  const hasSteps = stepProgress(card.steps).total > 0;
  const overdue = Boolean(card.dueDate) && isOverdue(card.dueDate!, todayIso);
  const hasMeta = Boolean(card.dueDate) || hasSteps || attachmentCount > 0 || tags.length > 0 || Boolean(assigneeName);

  return (
    <article
      className={`kanban-card${dragging ? ' kanban-card--dragging' : ''}`}
      data-task-card={card.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={t('kanbanCard.task', { title: card.title })}
    >
      <div className="kanban-card__head">
        {priority ? (
          <span
            className="kanban-card__quadrant"
            style={{ background: priority.color }}
            role="img"
            aria-label={priority.name}
            title={priority.name}
          />
        ) : null}
        <button type="button" className="kanban-card__title" title={card.title} onClick={onOpen}>
          {card.title}
        </button>
        {onStatusChange ? (
          <span
            className="kanban-card__menu"
            onDragStart={(event) => event.stopPropagation()}
          >
            <ActionMenu
              label={t('kanbanCard.statusMenu', { title: card.title })}
              items={CARD_STATUSES.map((value) => ({
                id: value,
                label: t(`taskStatus.${value}` as const),
                onSelect: () => onStatusChange(value)
              }))}
            />
          </span>
        ) : null}
      </div>

      {status !== 'open' ? (
        <span className={`kanban-card__status kanban-card__status--${status}`}>
          {t(`taskStatus.${status}` as const)}
        </span>
      ) : null}

      {hasMeta ? (
        <div className="kanban-card__meta">
          {card.dueDate ? (
            <span className={`kanban-card__date${overdue ? ' kanban-card__date--overdue' : ''}`}>
              <CalendarDays aria-hidden="true" />
              {formatDueDate(card.dueDate, todayIso)}
              {overdue ? <span className="visually-hidden">{t('kanbanCard.overdue')}</span> : null}
            </span>
          ) : null}
          <TaskStepCount steps={card.steps} />
          {assigneeName ? (
            <span className="kanban-card__assignee" title={assigneeName}>
              <UserCircle aria-hidden="true" />
              <span className="kanban-card__assignee-name">{assigneeName}</span>
            </span>
          ) : null}
          {attachmentCount > 0 ? (
            <span
              className="kanban-card__clip"
              aria-label={t('kanbanCard.attachments', { count: attachmentCount })}
            >
              <Paperclip aria-hidden="true" />
              {attachmentCount}
            </span>
          ) : null}
          {tags.map((tag) => (
            <span key={tag.id} className="kanban-tag" style={{ color: tag.color }}>
              <span className="kanban-tag__hash" aria-hidden="true">#</span>
              <span className="kanban-tag__name">{tag.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
