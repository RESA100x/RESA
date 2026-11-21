import { Copy, Pencil, Phone, X } from '../components/icons';
import { useEffect, useId, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { formatIsoDisplay, formatDisplayDate } from '../lib/calendar-system';
import type { Meeting } from '../meetings/meeting-model';
import { useNowlyRepository } from '../data/RepositoryContext';
import { useOptionalTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { taskStatus, type Task } from '../tasks/task-model';
import { ContactDialog } from './ContactDialog';
import { contactPhotoSource } from './contact-photo';
import {
  contactCategoryName,
  type Contact,
  type ContactLine
} from './contact-model';
import { useContacts } from './useContacts';
import { useContactCategories } from './useContactCategories';
import './contact-card.css';

type ContactCardDialogProps = {
  contactId: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onOpenContact?(id: string): void;
  onOpenTask?(id: string): void;
  onOpenMeeting?(id: string): void;
};

/** One `label: value` pair; renders nothing when the value is empty. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="contact-card__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function lineValues(lines: ContactLine[] | undefined): string {
  return (lines ?? [])
    .map((line) => line.value.trim())
    .filter(Boolean)
    .join('، ');
}

/**
 * Most dates are stored as `YYYY-MM-DD`, but the free-text reminder field also
 * accepts a Jalali stamp like `1404/09/01 10:00`. Format the ISO ones through
 * the active calendar and leave anything else exactly as the user typed it.
 */
function isoOrRaw(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? formatIsoDisplay(value, 'long') : value;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="contact-card__section">
      <h4>{title}</h4>
      <dl className="contact-card__facts">{children}</dl>
    </section>
  );
}

// The directory and the work attached to one person. Work is read here rather
// than passed in so the card is self-contained: the palette can open it without
// the board or the meetings module being mounted.
function useLinkedWork(contactId: string) {
  const repository = useNowlyRepository();
  const workspace = useOptionalTaskWorkspace();
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    const read = repository.listMeetings;
    if (!read) return;
    let cancelled = false;
    read
      .call(repository)
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const tasks = useMemo<Task[]>(() => {
    const board = workspace?.workspace.data.tasks ?? [];
    return board.filter((task) => task.assigneeContactId === contactId);
  }, [workspace?.workspace.data.tasks, contactId]);

  const linkedMeetings = useMemo(
    () =>
      meetings
        .filter(
          (meeting) =>
            meeting.attendees.some((attendee) => attendee.contactId === contactId) ||
            meeting.items.some((item) => item.ownerContactId === contactId)
        )
        .sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
    [meetings, contactId]
  );

  return { tasks, meetings: linkedMeetings };
}

/**
 * The read-only profile behind a phone-book row: everything stored about one
 * person or company, plus the work that points back at them. Editing hands off
 * to the same form the directory uses, so there is one editor, not two.
 */
export function ContactCardDialog({
  contactId,
  restoreFocusRef,
  onClose,
  onOpenContact,
  onOpenTask,
  onOpenMeeting
}: ContactCardDialogProps) {
  const titleId = useId();
  const { contacts, updateContact, deleteContact } = useContacts();
  const { categories, createCategory, updateCategory, deleteCategory } = useContactCategories();
  const { tasks, meetings } = useLinkedWork(contactId);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState('');

  const contact = contacts.data.find((row) => row.id === contactId) ?? null;

  if (editing && contact) {
    return (
      <ContactDialog
        mode={{ type: 'edit', contact }}
        categories={categories.data}
        contacts={contacts.data}
        onClose={() => setEditing(false)}
        onCreate={async () => undefined}
        onUpdate={async (row, draft) => {
          await updateContact(row, draft);
          setEditing(false);
        }}
        onDelete={async (row) => {
          await deleteContact(row);
          onClose();
        }}
        onCreateCategory={createCategory}
        onUpdateCategory={updateCategory}
        onDeleteCategory={deleteCategory}
      />
    );
  }

  async function copy(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied('');
    }
  }

  const category = contact ? contactCategoryName(contact.categoryId, categories.data) : '';
  const company = contact?.companyName
    ? contacts.data.find((row) => row.personality === 'legal' && row.name === contact.companyName) ?? null
    : null;
  const manager = contact?.profile.managerId
    ? contacts.data.find((row) => row.id === contact.profile.managerId) ?? null
    : null;
  const contactPerson = contact?.profile.contactPersonId
    ? contacts.data.find((row) => row.id === contact.profile.contactPersonId) ?? null
    : null;

  return (
    <Dialog
      title={t('contactCard.title')}
      ariaLabelledBy={titleId}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="contact-card"
      headerActions={
        <>
          {contact ? (
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('phonebook.edit', { name: contact.name })}
              title={t('phonebook.edit', { name: contact.name })}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </>
      }
      footer={
        copied ? (
          <span className="contact-card__copied" role="status">
            {t('phonebook.copied')}
          </span>
        ) : null
      }
    >
      {contacts.status === 'loading' && !contact ? (
        <p className="contact-card__empty">{t('contactCard.loading')}</p>
      ) : null}
      {!contact && contacts.status !== 'loading' ? (
        <p className="contact-card__empty">{t('contactCard.notFound')}</p>
      ) : null}

      {contact ? (
        <div className="contact-card__body">
          <header className="contact-card__head">
            <span className="contact-card__avatar" aria-hidden="true">
              {contact.photo ? (
                <img src={contactPhotoSource(contact.photo) ?? undefined} alt="" />
              ) : (
                <span>{contact.name.trim().slice(0, 1)}</span>
              )}
            </span>
            <div className="contact-card__identity">
              <h3>{contact.name}</h3>
              {contact.nickname && contact.nickname !== contact.name ? (
                <p className="contact-card__nickname">{contact.nickname}</p>
              ) : null}
              <p className="contact-card__line">
                {[contact.organization, contact.jobTitle].filter(Boolean).join(' • ')}
              </p>
              <div className="contact-card__badges">
                {contact.roles.map((role) => (
                  <span key={role} className="contact-card__badge">
                    {t(`phonebookRole.${role}` as const)}
                  </span>
                ))}
                {contact.isInternal ? (
                  <span className="contact-card__badge">{t('phonebook.internalBadge')}</span>
                ) : null}
                {contact.personality === 'legal' ? (
                  <span className="contact-card__badge">{t('phonebook.legalBadge')}</span>
                ) : null}
                {!contact.isActive ? (
                  <span className="contact-card__badge">{t('phonebook.inactiveBadge')}</span>
                ) : null}
              </div>
            </div>
            <div className="contact-card__actions">
              {contact.phone ? (
                <button
                  type="button"
                  className="good-button"
                  onClick={() => void copy(contact.phone, 'phone')}
                >
                  <Copy aria-hidden="true" />
                  {contact.phone}
                </button>
              ) : null}
              <a className="good-button" href={`tel:${contact.phone}`} aria-label={t('contactCard.call')}>
                <Phone aria-hidden="true" />
                {t('contactCard.call')}
              </a>
            </div>
          </header>

          <Section title={t('phonebookTab.channels')}>
            <Fact label={t('phonebookDialog.phone')}>{contact.phone}</Fact>
            <Fact label={t('phonebookDialog.extension')}>
              {contact.extension ? (
                <button
                  type="button"
                  className="contact-card__copy"
                  onClick={() => void copy(contact.extension, 'extension')}
                >
                  {t('phonebook.extensionShort', { extension: contact.extension })}
                </button>
              ) : null}
            </Fact>
            <Fact label={t('phonebookDialog.mobiles')}>{lineValues(contact.profile.mobiles)}</Fact>
            <Fact label={t('phonebookDialog.phones')}>{lineValues(contact.profile.phones)}</Fact>
            <Fact label={t('phonebookDialog.faxes')}>{lineValues(contact.profile.faxes)}</Fact>
            <Fact label={t('phonebookDialog.emails')}>
              {[contact.email, lineValues(contact.profile.emails)].filter(Boolean).join('، ')}
            </Fact>
            <Fact label={t('phonebookDialog.website')}>{contact.profile.website}</Fact>
            <Fact label={t('phonebookDialog.messengers')}>
              {contact.profile.messengers
                .map((messenger) => `${messenger.platform}: ${messenger.handle}`)
                .join('، ')}
            </Fact>
          </Section>

          <Section title={t('phonebookTab.organization')}>
            <Fact label={t('phonebookDialog.organization')}>{contact.organization}</Fact>
            <Fact label={t('phonebookDialog.jobTitle')}>{contact.jobTitle}</Fact>
            <Fact label={t('phonebookDialog.companyName')}>
              {contact.companyName ? (
                company && onOpenContact ? (
                  <button type="button" className="contact-card__link" onClick={() => onOpenContact(company.id)}>
                    {contact.companyName}
                  </button>
                ) : (
                  contact.companyName
                )
              ) : null}
            </Fact>
            <Fact label={t('phonebookDialog.manager')}>
              {manager && onOpenContact ? (
                <button type="button" className="contact-card__link" onClick={() => onOpenContact(manager.id)}>
                  {manager.name}
                </button>
              ) : (
                manager?.name ?? ''
              )}
            </Fact>
            <Fact label={t('phonebookDialog.contactPerson')}>
              {contactPerson && onOpenContact ? (
                <button type="button" className="contact-card__link" onClick={() => onOpenContact(contactPerson.id)}>
                  {contactPerson.name}
                </button>
              ) : (
                contactPerson?.name ?? ''
              )}
            </Fact>
            <Fact label={t('phonebookDialog.personnelCode')}>{contact.profile.personnelCode}</Fact>
            <Fact label={t('phonebookDialog.building')}>
              {[contact.profile.building, contact.profile.floor, contact.profile.room]
                .filter(Boolean)
                .join(' • ')}
            </Fact>
            <Fact label={t('phonebookDialog.shift')}>{contact.profile.shift}</Fact>
          </Section>

          <Section title={t('phonebookTab.dates')}>
            <Fact label={t('phonebookDialog.birthday')}>
              {contact.birthday ? formatIsoDisplay(contact.birthday, 'long') : null}
            </Fact>
            <Fact label={t('phonebookDialog.anniversary')}>
              {contact.profile.anniversaryDate ? formatIsoDisplay(contact.profile.anniversaryDate, 'long') : null}
            </Fact>
            <Fact label={t('phonebookDialog.hireDate')}>
              {contact.profile.hireDate ? formatIsoDisplay(contact.profile.hireDate, 'long') : null}
            </Fact>
            <Fact label={t('phonebookDialog.lastContact')}>
              {contact.profile.lastContactAt ? isoOrRaw(contact.profile.lastContactAt) : null}
            </Fact>
            <Fact label={t('phonebookDialog.nextReminder')}>
              {contact.profile.nextReminderAt ? isoOrRaw(contact.profile.nextReminderAt) : null}
            </Fact>
            <Fact label={t('phonebookDialog.reminderFrequency')}>
              {contact.profile.reminderFrequency === 'once'
                ? null
                : t(`phonebookReminder.${contact.profile.reminderFrequency}` as const)}
            </Fact>
          </Section>

          <Section title={t('phonebookDialog.category')}>
            <Fact label={t('phonebookDialog.category')}>{category}</Fact>
            <Fact label={t('phonebookDialog.tags')}>{contact.tags.join('، ')}</Fact>
            <Fact label={t('phonebookDialog.createdAt')}>{formatDisplayDate(new Date(contact.createdAt))}</Fact>
          </Section>

          {contact.contractStatus || contact.profile.contractor.contractNumber ? (
            <Section title={t('phonebookTab.contractor')}>
              <Fact label={t('phonebookDialog.contractStatus')}>
                {contact.contractStatus
                  ? t(`phonebookContractStatus.${contact.contractStatus}` as const)
                  : null}
              </Fact>
              <Fact label={t('phonebookDialog.contractorCompany')}>{contact.profile.contractor.company}</Fact>
              <Fact label={t('phonebookDialog.contractorField')}>{contact.profile.contractor.field}</Fact>
              <Fact label={t('phonebookDialog.contractNumber')}>{contact.profile.contractor.contractNumber}</Fact>
              <Fact label={t('phonebookDialog.contractStart')}>
                {contact.profile.contractor.contractStart
                  ? formatIsoDisplay(contact.profile.contractor.contractStart, 'long')
                  : null}
              </Fact>
              <Fact label={t('phonebookDialog.contractEnd')}>
                {contact.profile.contractor.contractEnd
                  ? formatIsoDisplay(contact.profile.contractor.contractEnd, 'long')
                  : null}
              </Fact>
              <Fact label={t('phonebookDialog.contractAmount')}>{contact.profile.contractor.contractAmount}</Fact>
            </Section>
          ) : null}

          {contact.profile.supplier.category || contact.profile.supplier.brands ? (
            <Section title={t('phonebookTab.supplier')}>
              <Fact label={t('phonebookDialog.supplyCategory')}>{contact.profile.supplier.category}</Fact>
              <Fact label={t('phonebookDialog.supplierBrands')}>{contact.profile.supplier.brands}</Fact>
              <Fact label={t('phonebookDialog.paymentTerms')}>{contact.profile.supplier.paymentTerms}</Fact>
              <Fact label={t('phonebookDialog.settlementDays')}>{contact.profile.supplier.settlementDays}</Fact>
              <Fact label={t('phonebookDialog.iban')}>{contact.profile.supplier.iban}</Fact>
              <Fact label={t('phonebookDialog.bank')}>{contact.profile.supplier.bank}</Fact>
            </Section>
          ) : null}

          <Section title={t('phonebookTab.address')}>
            <Fact label={t('phonebookDialog.address')}>{contact.address}</Fact>
            {contact.profile.addresses.map((address, index) => (
              <Fact
                key={`${address.fullAddress}-${index}`}
                label={address.label || t('phonebookDialog.addressLabel')}
              >
                {[address.province, address.city, address.fullAddress, address.postalCode]
                  .filter(Boolean)
                  .join('، ')}
              </Fact>
            ))}
          </Section>

          {contact.note ? (
            <section className="contact-card__section">
              <h4>{t('phonebookTab.notes')}</h4>
              <p className="contact-card__note">{contact.note}</p>
            </section>
          ) : null}

          {contact.profile.attachments.length > 0 ? (
            <section className="contact-card__section">
              <h4>{t('phonebookDialog.attachments')}</h4>
              <ul className="contact-card__links">
                {contact.profile.attachments.map((attachment, index) => (
                  <li key={`${attachment.name}-${index}`}>
                    <a href={attachment.url} target="_blank" rel="noreferrer">
                      {attachment.name || attachment.url}
                    </a>
                    {attachment.kind ? <span className="contact-card__muted">{attachment.kind}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="contact-card__section">
            <h4>{t('contactCard.tasks')}</h4>
            {tasks.length === 0 ? (
              <p className="contact-card__empty">{t('contactCard.noTasks')}</p>
            ) : (
              <ul className="contact-card__links">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="contact-card__link"
                      disabled={!onOpenTask}
                      onClick={() => onOpenTask?.(task.id)}
                    >
                      {task.title}
                    </button>
                    <span className={`contact-card__status contact-card__status--${taskStatus(task)}`}>
                      {t(`taskStatus.${taskStatus(task)}` as const)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="contact-card__section">
            <h4>{t('contactCard.meetings')}</h4>
            {meetings.length === 0 ? (
              <p className="contact-card__empty">{t('contactCard.noMeetings')}</p>
            ) : (
              <ul className="contact-card__links">
                {meetings.map((meeting) => (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      className="contact-card__link"
                      disabled={!onOpenMeeting}
                      onClick={() => onOpenMeeting?.(meeting.id)}
                    >
                      {meeting.title}
                    </button>
                    <span className="contact-card__muted">
                      {formatIsoDisplay(meeting.startsAt.slice(0, 10), 'long')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}
