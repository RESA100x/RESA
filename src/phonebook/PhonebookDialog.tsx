import { Copy, Download, FileText, Pencil, Plus, Search, UserCircle, X } from '../components/icons';
import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { FilterSelect } from '../components/FilterSelect';
import { t } from '../i18n';
import { anniversaryOccurrence, displayMonthDayOf, displayMonthOf, formatIsoDisplay } from '../lib/calendar-system';
import { ContactDialog } from './ContactDialog';
import { ContactCardDialog } from './ContactCardDialog';
import { PhonebookGroupsPanel } from './PhonebookGroupsPanel';
import { copyText } from './clipboard';
import { filterContacts } from './contact-search';
import { contactPhotoSource } from './contact-photo';
import {
  CONTACT_ROLES,
  contactCategoryName,
  type Contact,
  type ContactCategory,
  type ContactCategoryDraft,
  type ContactDraft,
  type ContactsExportSummary,
  type ContactsImportSummary,
  type ContactRole
} from './contact-model';
import type { ContactCategoriesResource } from './useContactCategories';
import type { ContactsResource } from './useContacts';
import { requestModal } from '../lib/modal-store';

type ContactDialogState = { type: 'create' } | { type: 'edit'; contact: Contact } | null;
type Tab = 'all' | 'internal' | 'contractors' | 'suppliers' | 'managers' | 'groups';

type PhonebookDialogProps = {
  resource: ContactsResource;
  categories: ContactCategoriesResource;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRetry(): void;
  onRetryCategories(): void;
  onClose(): void;
  onCreate(draft: ContactDraft): Promise<unknown>;
  onUpdate(contact: Contact, draft: ContactDraft): Promise<unknown>;
  onDelete(contact: Contact): Promise<unknown>;
  onCreateCategory(draft: ContactCategoryDraft): Promise<ContactCategory>;
  onUpdateCategory(id: string, draft: ContactCategoryDraft): Promise<ContactCategory>;
  onDeleteCategory(id: string): Promise<void>;
  onExport?(path: string): Promise<ContactsExportSummary>;
  onImport?(path: string, commit: boolean): Promise<ContactsImportSummary>;
  onExportVcard?(path: string): Promise<ContactsExportSummary>;
  onImportVcard?(path: string, commit: boolean): Promise<ContactsImportSummary>;
};

const EMPTY_CATEGORIES: ContactCategory[] = [];

// Smart filters answer the questions the row of tabs cannot: who has a
// birthday this month, who has not been called in a while, and whose contract
// is about to run out. They are computed here because the directory is capped
// and already loaded.
type SmartFilter = '' | 'birthday' | 'stale' | 'expiring';

const STALE_DAYS = 90;
const EXPIRING_DAYS = 60;

function isoOfLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `today` to an ISO date; negative for dates in the past. */
function daysUntil(isoDate: string, today: Date) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(year, month - 1, day).getTime();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - base) / 86_400_000);
}

function matchesSmartFilter(contact: Contact, filter: SmartFilter, today: Date) {
  if (!filter) return true;
  if (filter === 'birthday') {
    if (!contact.birthday) return false;
    const occurrence = anniversaryOccurrence(contact.birthday, displayMonthOf(today).year);
    return occurrence !== null && displayMonthDayOf(occurrence).month === displayMonthDayOf(isoOfLocal(today)).month;
  }
  if (filter === 'stale') {
    const last = contact.profile.lastContactAt;
    return Boolean(last) && daysUntil(last, today) <= -STALE_DAYS;
  }
  const end = contact.profile.contractor.contractEnd;
  if (!end) return false;
  const days = daysUntil(end, today);
  return days >= 0 && days <= EXPIRING_DAYS;
}

function contactsFileName() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `resa-contacts-${stamp}.csv`;
}

// The picker offers both formats; the chosen extension decides which backend
// command runs, so the header needs one import button and one export button.
const transferFilters = [
  { name: 'CSV', extensions: ['csv'] },
  { name: 'vCard', extensions: ['vcf'] }
];

/** True when the picked file is a vCard, i.e. transfer through the .vcf path. */
function isVcardPath(path: string) {
  return path.toLowerCase().endsWith('.vcf');
}

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('phonebook.transferFailed');
}

function roleLabel(role: ContactRole) {
  return t(`phonebookRole.${role}`);
}

/**
 * The directory itself. The tabs answer the questions it is opened for — who is
 * in the organisation, which contractors and suppliers do we have, who manages
 * something — and the filter row narrows any of them by personality, role,
 * group and contract status. Filtering runs here rather than in the backend
 * because the list is capped (2000 rows) and has to feel instant while typing.
 */
export function PhonebookDialog({
  resource,
  categories,
  restoreFocusRef,
  onRetry,
  onRetryCategories,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onExport,
  onImport,
  onExportVcard,
  onImportVcard
}: PhonebookDialogProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [personalityFilter, setPersonalityFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [smartFilter, setSmartFilter] = useState<SmartFilter>('');
  const [form, setForm] = useState<ContactDialogState>(null);
  const [cardContactId, setCardContactId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
  const [transferStatus, setTransferStatus] = useState('');
  const [transferError, setTransferError] = useState('');
  const [pendingImport, setPendingImport] = useState<{ path: string; summary: ContactsImportSummary; vcard: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const groups = categories.data.length > 0 ? categories.data : EMPTY_CATEGORIES;
  const total = resource.data.length;
  const canTransfer = Boolean((onExport || onExportVcard) && (onImport || onImportVcard));
  const internalCount = useMemo(() => resource.data.filter((contact) => contact.isInternal).length, [resource.data]);
  const roleCount = (role: ContactRole) =>
    resource.data.filter((contact) => contact.roles.includes(role)).length;

  const scoped = useMemo(() => {
    if (tab === 'internal') return resource.data.filter((contact) => contact.isInternal);
    if (tab === 'contractors') return resource.data.filter((contact) => contact.roles.includes('contractor'));
    if (tab === 'suppliers') return resource.data.filter((contact) => contact.roles.includes('supplier'));
    if (tab === 'managers') return resource.data.filter((contact) => contact.roles.includes('manager'));
    return resource.data;
  }, [resource.data, tab]);

  const filtered = useMemo(
    () => {
      const today = new Date();
      return scoped.filter((contact) => {
        if (!matchesSmartFilter(contact, smartFilter, today)) return false;
        if (groupFilter && contact.categoryId !== groupFilter) return false;
        if (personalityFilter && contact.personality !== personalityFilter) return false;
        if (roleFilter && !contact.roles.includes(roleFilter as ContactRole)) return false;
        if (statusFilter && contact.contractStatus !== statusFilter) return false;
        return true;
      });
    },
    [scoped, smartFilter, groupFilter, personalityFilter, roleFilter, statusFilter]
  );

  const visible = useMemo(() => filterContacts(filtered, query, groups), [filtered, query, groups]);
  const searching = query.trim().length > 0;
  const filteredOut = visible.length !== scoped.length;

  function showTab(next: Tab) {
    setTab(next);
    if (next !== 'all') setGroupFilter('');
  }

  async function copyContact(contact: Contact) {
    const value = contact.extension || contact.phone || contact.email || contact.name;
    if (await copyText(value)) setCopiedId(contact.id);
  }

  async function runExport() {
    if (!onExport && !onExportVcard) return;
    setTransferError('');
    setTransferStatus('');
    const path = await save({ defaultPath: contactsFileName(), filters: transferFilters }).catch(() => null);
    if (!path) return;
    setTransferBusy('export');
    try {
      const summary =
        isVcardPath(path) && onExportVcard
          ? await onExportVcard(path)
          : await onExport!(path);
      setTransferStatus(t('phonebook.transferExported', { path: summary.path, count: summary.contacts }));
    } catch (reason) {
      setTransferError(message(reason));
    } finally {
      setTransferBusy(null);
    }
  }

  async function chooseImport() {
    if (!onImport && !onImportVcard) return;
    setTransferError('');
    setTransferStatus('');
    const picked = await open({ multiple: false, filters: transferFilters }).catch(() => null);
    if (typeof picked !== 'string') return;
    setTransferBusy('import');
    try {
      // Read the file first and show what *would* happen; nothing is written
      // until the user confirms the preview.
      const vcard = isVcardPath(picked) && Boolean(onImportVcard);
      const summary = vcard ? await onImportVcard!(picked, false) : await onImport!(picked, false);
      setPendingImport({ path: picked, summary, vcard });
    } catch (reason) {
      setTransferError(message(reason));
    } finally {
      setTransferBusy(null);
    }
  }

  async function runImport() {
    if (!pendingImport) return;
    const commit = pendingImport.vcard ? onImportVcard : onImport;
    if (!commit) return;
    setTransferBusy('import');
    try {
      const summary = await commit(pendingImport.path, true);
      setTransferStatus(t('phonebook.transferImported', { count: summary.imported }));
      setPendingImport(null);
    } catch (reason) {
      setTransferError(message(reason));
      setPendingImport(null);
    } finally {
      setTransferBusy(null);
    }
  }

  const personalityOptions = [
    { value: '', label: t('phonebook.filterAny') },
    { value: 'individual', label: t('phonebookPersonality.individual') },
    { value: 'legal', label: t('phonebookPersonality.legal') }
  ];
  const roleOptions = [
    { value: '', label: t('phonebook.filterAny') },
    ...CONTACT_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))
  ];
  const statusOptions = [
    { value: '', label: t('phonebook.filterAny') },
    { value: 'active', label: t('phonebookContractStatus.active') },
    { value: 'expired', label: t('phonebookContractStatus.expired') },
    { value: 'suspended', label: t('phonebookContractStatus.suspended') }
  ];

  return (
    <Dialog
      title={t('widget.phonebook.name')}
      ariaLabelledBy={titleId}
      isTopLayer={!form && !pendingImport && !cardContactId}
      initialFocusRef={searchRef}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="phonebook-dialog"
      headerActions={
        <>
          {canTransfer ? (
            <>
              <button
                type="button"
                className="good-icon-button"
                aria-label={t('phonebook.transferImport')}
                title={t('phonebook.transferImport')}
                disabled={transferBusy !== null}
                onClick={() => void chooseImport()}
              >
                <Download className="phonebook-icon-flip" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="good-icon-button"
                aria-label={t('phonebook.transferExport')}
                title={t('phonebook.transferExport')}
                disabled={transferBusy !== null}
                onClick={() => void runExport()}
              >
                <Download aria-hidden="true" />
              </button>
            </>
          ) : null}
          {tab === 'internal' ? (
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('phonebook.printInternal')}
              title={t('phonebook.printInternal')}
              onClick={() => window.print()}
            >
              <FileText aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('phonebook.add')}
            title={t('phonebook.add')}
            onClick={() => setForm({ type: 'create' })}
          >
            <Plus aria-hidden="true" />
          </button>
          <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </>
      }
      footer={
        <div className="phonebook-dialog__footer">
          <span>{t('phonebook.count', { count: total })}</span>
          {searching || filteredOut ? (
            <span className="phonebook-dialog__shown">{t('phonebook.showing', { count: visible.length })}</span>
          ) : null}
          {copiedId ? (
            <span className="phonebook-dialog__copied" role="status">
              {t('phonebook.copied')}
            </span>
          ) : null}
          {transferStatus ? (
            <span className="phonebook-dialog__status" role="status">
              {transferStatus}
            </span>
          ) : null}
          {transferError ? (
            <span className="dialog-error" role="alert">
              {transferError}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="phonebook-search">
        <Search className="phonebook-search__icon" aria-hidden="true" />
        <input
          ref={searchRef}
          id="phonebook-search"
          type="search"
          className="good-input phonebook-search__input"
          autoComplete="off"
          aria-label={t('phonebook.search')}
          placeholder={t('phonebook.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="phonebook-tabs" role="tablist" aria-label={t('phonebook.tabs')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all'}
          className={`phonebook-tab${tab === 'all' ? ' is-active' : ''}`}
          onClick={() => showTab('all')}
        >
          {t('phonebook.tab.all')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'internal'}
          className={`phonebook-tab${tab === 'internal' ? ' is-active' : ''}`}
          onClick={() => showTab('internal')}
        >
          {t('phonebook.tab.internal')}
          {internalCount > 0 ? <span className="phonebook-tab__count">{internalCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'contractors'}
          className={`phonebook-tab${tab === 'contractors' ? ' is-active' : ''}`}
          onClick={() => showTab('contractors')}
        >
          {t('phonebook.tab.contractors')}
          {roleCount('contractor') > 0 ? <span className="phonebook-tab__count">{roleCount('contractor')}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'suppliers'}
          className={`phonebook-tab${tab === 'suppliers' ? ' is-active' : ''}`}
          onClick={() => showTab('suppliers')}
        >
          {t('phonebook.tab.suppliers')}
          {roleCount('supplier') > 0 ? <span className="phonebook-tab__count">{roleCount('supplier')}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'managers'}
          className={`phonebook-tab${tab === 'managers' ? ' is-active' : ''}`}
          onClick={() => showTab('managers')}
        >
          {t('phonebook.tab.managers')}
          {roleCount('manager') > 0 ? <span className="phonebook-tab__count">{roleCount('manager')}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'groups'}
          className={`phonebook-tab${tab === 'groups' ? ' is-active' : ''}`}
          onClick={() => showTab('groups')}
        >
          {t('phonebook.tab.groups')}
        </button>
      </div>

      {tab !== 'groups' ? (
        <div className="phonebook-filters">
          <FilterSelect
            label={t('phonebook.filterPersonality')}
            ariaLabel={t('phonebook.filterPersonality')}
            options={personalityOptions}
            value={personalityFilter}
            onChange={setPersonalityFilter}
          />
          <FilterSelect
            label={t('phonebook.filterRole')}
            ariaLabel={t('phonebook.filterRole')}
            options={roleOptions}
            value={roleFilter}
            onChange={setRoleFilter}
          />
          <FilterSelect
            label={t('phonebook.filterContract')}
            ariaLabel={t('phonebook.filterContract')}
            options={statusOptions}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          {(personalityFilter || roleFilter || statusFilter || groupFilter || smartFilter) ? (
            <button
              type="button"
              className="phonebook-filter-reset"
              onClick={() => {
                setPersonalityFilter('');
                setRoleFilter('');
                setStatusFilter('');
                setGroupFilter('');
                setSmartFilter('');
              }}
            >
              {t('phonebook.filterReset')}
            </button>
          ) : null}
        </div>
      ) : null}

      {tab !== 'groups' ? (
        <div className="phonebook-chips" role="group" aria-label={t('phonebook.smartFilterLabel')}>
          <button
            type="button"
            className={`phonebook-chip${smartFilter === 'birthday' ? ' is-active' : ''}`}
            aria-pressed={smartFilter === 'birthday'}
            onClick={() => setSmartFilter(smartFilter === 'birthday' ? '' : 'birthday')}
          >
            {t('phonebook.smartBirthday')}
          </button>
          <button
            type="button"
            className={`phonebook-chip${smartFilter === 'stale' ? ' is-active' : ''}`}
            aria-pressed={smartFilter === 'stale'}
            onClick={() => setSmartFilter(smartFilter === 'stale' ? '' : 'stale')}
          >
            {t('phonebook.smartStale')}
          </button>
          <button
            type="button"
            className={`phonebook-chip${smartFilter === 'expiring' ? ' is-active' : ''}`}
            aria-pressed={smartFilter === 'expiring'}
            onClick={() => setSmartFilter(smartFilter === 'expiring' ? '' : 'expiring')}
          >
            {t('phonebook.smartExpiring')}
          </button>
        </div>
      ) : null}

      {tab === 'all' && groups.length > 0 ? (
        <div className="phonebook-chips" role="group" aria-label={t('phonebook.filter.label')}>
          <button
            type="button"
            className={`phonebook-chip${groupFilter === '' ? ' is-active' : ''}`}
            aria-pressed={groupFilter === ''}
            onClick={() => setGroupFilter('')}
          >
            {t('phonebook.filter.all')}
          </button>
          {groups.map((group) => {
            const count = resource.data.filter((contact) => contact.categoryId === group.id).length;
            return (
              <button
                key={group.id}
                type="button"
                className={`phonebook-chip${groupFilter === group.id ? ' is-active' : ''}`}
                aria-pressed={groupFilter === group.id}
                onClick={() => setGroupFilter(groupFilter === group.id ? '' : group.id)}
              >
                <span className="phonebook-chip__dot" style={{ background: group.color }} aria-hidden="true" />
                {group.name}
                <span className="phonebook-chip__count">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="phonebook-dialog__body" data-testid="phonebook-scroll">
        {resource.status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{resource.message ?? t('phonebook.readError')}</span>
            <div className="module-message__actions">
              <button type="button" className="good-button" onClick={onRetry}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : null}

        {categories.status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{categories.message ?? t('phonebook.readError')}</span>
            <div className="module-message__actions">
              <button type="button" className="good-button" onClick={onRetryCategories}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'groups' ? (
          <PhonebookGroupsPanel
            categories={groups}
            contacts={resource.data}
            onCreate={onCreateCategory}
            onUpdate={onUpdateCategory}
            onDelete={onDeleteCategory}
          />
        ) : (
          <>
            {resource.status === 'loading' && total === 0 ? <p className="phonebook-dialog__empty">{t('phonebook.loading')}</p> : null}

            {resource.status !== 'loading' && total === 0 ? (
              <div className="phonebook-dialog__empty">
                <p>{t('phonebook.empty')}</p>
                <button type="button" className="good-button" onClick={() => setForm({ type: 'create' })}>
                  {t('phonebook.add')}
                </button>
              </div>
            ) : null}

            {total > 0 && scoped.length === 0 ? (
              <p className="phonebook-dialog__empty">{t('phonebook.emptyView')}</p>
            ) : null}

            {total > 0 && scoped.length > 0 && visible.length === 0 ? (
              <p className="phonebook-dialog__empty">{t('phonebook.noMatch', { query: query.trim() })}</p>
            ) : null}

            {visible.length > 0 ? (
              <ul className="phonebook-list">
                {visible.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    categoryName={contactCategoryName(contact.categoryId, groups)}
                    categoryColor={groups.find((group) => group.id === contact.categoryId)?.color}
                    copied={copiedId === contact.id}
                    onCopy={() => void copyContact(contact)}
                    onOpen={() => setCardContactId(contact.id)}
                    onEdit={() => setForm({ type: 'edit', contact })}
                  />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {form ? (
        <ContactDialog
          mode={form}
          categories={groups}
          contacts={resource.data}
          onClose={() => setForm(null)}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCreateCategory={onCreateCategory}
          onUpdateCategory={onUpdateCategory}
          onDeleteCategory={onDeleteCategory}
        />
      ) : null}

      {pendingImport ? (
        <ConfirmDialog
          title={t('phonebook.transferPreviewTitle')}
          description={t('phonebook.transferPreviewBody', {
            read: pendingImport.summary.read,
            imported: pendingImport.summary.imported,
            duplicated: pendingImport.summary.duplicated,
            skipped: pendingImport.summary.skipped
          })}
          confirmLabel={t('phonebook.transferConfirm', { count: pendingImport.summary.imported })}
          busyLabel={t('phonebook.transferImporting')}
          busy={transferBusy === 'import'}
          onCancel={() => setPendingImport(null)}
          onConfirm={() => void runImport()}
        />
      ) : null}

      {cardContactId ? (
        <ContactCardDialog
          contactId={cardContactId}
          onClose={() => setCardContactId(null)}
          onOpenContact={setCardContactId}
          onOpenTask={(id) => requestModal({ type: 'task-open', taskId: id, trigger: null })}
          onOpenMeeting={(id) => requestModal({ type: 'meeting-edit', meetingId: id, trigger: null })}
        />
      ) : null}
    </Dialog>
  );
}

type ContactRowProps = {
  contact: Contact;
  categoryName: string;
  categoryColor?: string;
  copied: boolean;
  onCopy(): void;
  onOpen(): void;
  onEdit(): void;
};

function ContactRow({ contact, categoryName, categoryColor, copied, onCopy, onOpen, onEdit }: ContactRowProps) {
  const role = [contact.jobTitle, contact.organization || contact.companyName].filter(Boolean).join(' · ');
  const avatar = contactPhotoSource(contact.photo);
  const roles = contact.roles.filter((entry) => entry !== 'colleague');
  return (
    <li className={`phonebook-row${contact.isActive ? '' : ' is-inactive'}`} data-testid={`phonebook-row-${contact.id}`}>
      <span className="phonebook-row__avatar" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" /> : <UserCircle />}
      </span>
      <button
        type="button"
        className="phonebook-row__body"
        aria-label={t('phonebook.openCard', { name: contact.name })}
        onClick={onOpen}
      >
        <div className="phonebook-row__heading">
          {contact.isFavorite ? <span className="phonebook-row__star" title={t('phonebookDialog.favorite')} aria-hidden="true">★</span> : null}
          <span className="phonebook-row__name">{contact.name}</span>
          {contact.nickname ? <span className="phonebook-row__nickname">{contact.nickname}</span> : null}
          {contact.isInternal ? <span className="phonebook-row__badge">{t('phonebook.internalBadge')}</span> : null}
          {contact.personality === 'legal' ? (
            <span className="phonebook-row__badge phonebook-row__badge--muted">{t('phonebook.legalBadge')}</span>
          ) : null}
          {!contact.isActive ? <span className="phonebook-row__badge phonebook-row__badge--muted">{t('phonebook.inactiveBadge')}</span> : null}
          {categoryName ? (
            <span className="phonebook-row__tag">
              <span className="phonebook-row__tag-dot" style={{ background: categoryColor }} aria-hidden="true" />
              {categoryName}
            </span>
          ) : null}
        </div>
        {roles.length > 0 ? (
          <span className="phonebook-row__roles">
            {roles.map((entry) => (
              <span key={entry} className="phonebook-row__role-chip">
                {roleLabel(entry)}
              </span>
            ))}
          </span>
        ) : null}
        {role ? <span className="phonebook-row__role">{role}</span> : null}
        <div className="phonebook-row__numbers">
          {contact.extension ? (
            <span className="phonebook-row__extension" dir="ltr">
              {t('phonebook.extensionShort', { extension: contact.extension })}
            </span>
          ) : null}
          {contact.phone ? (
            // Numbers are read left to right even on an RTL page, otherwise
            // "+49 30" flips around the plus sign.
            <span className="phonebook-row__phone" dir="ltr">
              {contact.phone}
            </span>
          ) : null}
          {contact.email ? (
            <span className="phonebook-row__phone" dir="ltr">
              {contact.email}
            </span>
          ) : null}
          {contact.birthday ? (
            <span className="phonebook-row__birthday">{t('phonebook.birthdayShort', { date: formatIsoDisplay(contact.birthday) })}</span>
          ) : null}
        </div>
        {contact.tags.length > 0 ? (
          <span className="phonebook-row__tags">{contact.tags.join(' · ')}</span>
        ) : null}
        {contact.note ? <span className="phonebook-row__note">{contact.note}</span> : null}
      </button>
      <span className="phonebook-row__tools">
        {contact.phone || contact.extension || contact.email ? (
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('phonebook.copyPhone', { name: contact.name })}
            title={t('phonebook.copyPhone', { name: contact.name })}
            onClick={onCopy}
          >
            <Copy aria-hidden="true" />
          </button>
        ) : null}
        {copied ? <span className="phonebook-row__copied" role="status">{t('phonebook.copied')}</span> : null}
        <button
          type="button"
          className="good-icon-button"
          aria-label={t('phonebook.edit', { name: contact.name })}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
