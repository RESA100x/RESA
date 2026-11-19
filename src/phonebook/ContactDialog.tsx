import { GalleryCircle, Plus, Trash2, UserCircle, X } from '../components/icons';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CategorySelect } from '../components/CategorySelect';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DatePicker } from '../components/DatePicker';
import { Dialog } from '../components/Dialog';
import { Select, type SelectOption } from '../components/Select';
import { t } from '../i18n';
import { formatIsoDisplay } from '../lib/calendar-system';
import {
  contactToForm,
  createContactForm,
  isContactFormDirty,
  parseTagInput,
  toContactDraft,
  validateContactForm,
  type ContactFieldErrors,
  type ContactFormDraft
} from './contact-draft';
import {
  CONTACT_ADDRESS_MAX_LENGTH,
  CONTACT_COLLECTION_MAX,
  CONTACT_FIELD_MAX_LENGTH,
  CONTACT_GENDERS,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_NOTE_MAX_LENGTH,
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  MESSENGER_PLATFORMS,
  REMINDER_FREQUENCIES,
  emptyContactAddress,
  emptyContactLine,
  type Contact,
  type ContactAddress,
  type ContactAttachment,
  type ContactCategory,
  type ContactCategoryDraft,
  type ContactDraft,
  type ContactGender,
  type ContactLine,
  type ContactMessenger,
  type ContactRole
} from './contact-model';
import { contactPhotoSource, prepareContactPhoto } from './contact-photo';

type ContactDialogProps = {
  mode: { type: 'create' } | { type: 'edit'; contact: Contact };
  categories: ContactCategory[];
  /** The loaded directory, so a field can link to another contact. */
  contacts: Contact[];
  onClose(): void;
  onCreate(draft: ContactDraft): Promise<unknown>;
  onUpdate(contact: Contact, draft: ContactDraft): Promise<unknown>;
  onDelete(contact: Contact): Promise<unknown>;
  onCreateCategory(draft: ContactCategoryDraft): Promise<ContactCategory>;
  onUpdateCategory(id: string, draft: ContactCategoryDraft): Promise<ContactCategory>;
  onDeleteCategory(id: string): Promise<void>;
};

type TabId =
  | 'identity'
  | 'channels'
  | 'organization'
  | 'contractor'
  | 'supplier'
  | 'address'
  | 'dates'
  | 'notes';

/**
 * The form is read as eight tabs, and five of them are unconditional. The other
 * three appear the moment the contact says something about itself: tick
 * "colleague" and the organisational tab exists, add the contractor role and its
 * tab exists. That is what keeps one shared model from turning into a wall of
 * seventy inputs.
 */
const TABS: Array<{ id: TabId; labelKey: string }> = [
  { id: 'identity', labelKey: 'phonebookTab.identity' },
  { id: 'channels', labelKey: 'phonebookTab.channels' },
  { id: 'organization', labelKey: 'phonebookTab.organization' },
  { id: 'contractor', labelKey: 'phonebookTab.contractor' },
  { id: 'supplier', labelKey: 'phonebookTab.supplier' },
  { id: 'address', labelKey: 'phonebookTab.address' },
  { id: 'dates', labelKey: 'phonebookTab.dates' },
  { id: 'notes', labelKey: 'phonebookTab.notes' }
];

/** Where a validation error lives, so Save can open the tab that holds it. */
const ERROR_TAB: Record<string, TabId> = {
  name: 'identity',
  companyName: 'identity',
  photo: 'identity',
  nationalId: 'identity',
  nationalEntityId: 'identity',
  registrationDate: 'identity',
  phone: 'channels',
  email: 'channels',
  website: 'channels',
  postalCode: 'address',
  birthday: 'dates',
  anniversaryDate: 'dates',
  lastContactAt: 'dates',
  hireDate: 'organization',
  contractStart: 'contractor',
  contractEnd: 'contractor'
};

function message(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error.message as string)
    : t('common.opFailed');
}

function withRole(roles: ContactRole[], role: ContactRole, on: boolean): ContactRole[] {
  if (on) return roles.includes(role) ? roles : [...roles, role];
  return roles.filter((item) => item !== role);
}

export function ContactDialog({
  mode,
  categories,
  contacts,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory
}: ContactDialogProps) {
  const initial = useMemo<ContactFormDraft>(
    () => (mode.type === 'edit' ? contactToForm(mode.contact) : createContactForm()),
    [mode]
  );
  const [form, setForm] = useState<ContactFormDraft>(initial);
  const [fieldError, setFieldError] = useState<ContactFieldErrors>({});
  const [dialogError, setDialogError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openPicker, setOpenPicker] = useState('');
  const [categoryOverlay, setCategoryOverlay] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => { setForm(initial); setActiveTab('identity'); }, [initial]);

  const isLegal = form.personality === 'legal';
  const isContractor = form.roles.includes('contractor');
  const isSupplier = form.roles.includes('supplier');

  const visibleTabs = useMemo(
    () =>
      TABS.filter((tab) => {
        if (tab.id === 'organization') return form.isInternal;
        if (tab.id === 'contractor') return isContractor;
        if (tab.id === 'supplier') return isSupplier;
        return true;
      }),
    [form.isInternal, isContractor, isSupplier]
  );

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab('identity');
  }, [visibleTabs, activeTab]);

  function update(patch: Partial<ContactFormDraft>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateProfile(patch: Partial<ContactFormDraft['profile']>) {
    setForm((current) => ({ ...current, profile: { ...current.profile, ...patch } }));
  }

  function setInternal(next: boolean) {
    setForm((current) => ({
      ...current,
      isInternal: next,
      roles: withRole(current.roles, 'colleague', next)
    }));
  }

  function toggleRole(role: ContactRole) {
    setForm((current) => {
      const on = !current.roles.includes(role);
      return {
        ...current,
        roles: withRole(current.roles, role, on),
        isInternal: role === 'colleague' ? on : current.isInternal
      };
    });
  }

  function requestClose() {
    if (busy) return;
    onClose();
  }

  async function save() {
    const errors = validateContactForm(form);
    setFieldError(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      const tab = ERROR_TAB[firstError];
      if (tab && visibleTabs.some((entry) => entry.id === tab)) setActiveTab(tab);
      return;
    }
    setDialogError('');
    setBusy(true);
    try {
      const draft = toContactDraft(form);
      if (mode.type === 'create') await onCreate(draft);
      else await onUpdate(mode.contact, draft);
      onClose();
    } catch (reason) {
      setDialogError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.type !== 'edit') return;
    setDialogError('');
    setBusy(true);
    try {
      await onDelete(mode.contact);
      setConfirmDelete(false);
      onClose();
    } catch (reason) {
      setConfirmDelete(false);
      setDialogError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a removal.
    event.target.value = '';
    if (!file) return;
    setPhotoError('');
    try {
      update({ photo: await prepareContactPhoto(file) });
    } catch {
      setPhotoError(t('phonebookDialog.photoError'));
    }
  }

  const avatar = contactPhotoSource(form.photo);
  const contactOptions: SelectOption[] = contacts
    .filter((contact) => mode.type !== 'edit' || contact.id !== mode.contact.id)
    .map((contact) => ({ value: contact.id, label: contact.name }));
  const categoryOptions: SelectOption[] = categories.map((category) => ({
    value: category.id,
    label: category.name,
    color: category.color
  }));
  const unchanged = mode.type === 'edit' && !isContactFormDirty(initial, form);
  const picker = (id: string) => ({
    open: openPicker === id,
    onOpenChange: (open: boolean) => setOpenPicker(open ? id : '')
  });

  return (
    <Dialog
      title={mode.type === 'create' ? t('phonebookDialog.createTitle') : t('phonebookDialog.editTitle')}
      ariaLabelledBy={titleId}
      isTopLayer={!confirmDelete && !categoryOverlay}
      onRequestClose={requestClose}
      className="phonebook-form-dialog"
      headerActions={
        <button type="button" aria-label={t('common.close')} className="good-icon-button" disabled={busy} onClick={requestClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <div className="phonebook-form-dialog__actions">
          {dialogError ? (
            <div role="alert" className="dialog-error">
              {dialogError}
            </div>
          ) : null}
          {mode.type === 'edit' ? (
            <button type="button" className="good-button good-button--danger-ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {t('phonebookDialog.deleteContact')}
            </button>
          ) : null}
          <button type="button" className="good-button" disabled={busy} onClick={requestClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="good-button good-button--primary"
            disabled={busy || unchanged}
            onClick={() => void save()}
          >
            {busy ? t('common.saving') : t('phonebookDialog.saveContact')}
          </button>
        </div>
      }
    >
      <form className="phonebook-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="phonebook-form__tabs" role="tablist" aria-label={t('phonebookDialog.tabs')}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`contact-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`contact-panel-${tab.id}`}
              className={`phonebook-form__tab${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {activeTab === 'identity' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-identity" aria-labelledby="contact-tab-identity">
            <div className="phonebook-photo">
              <span className="phonebook-photo__frame" aria-hidden="true">
                {avatar ? <img src={avatar} alt="" /> : <UserCircle />}
              </span>
              <div className="phonebook-photo__actions">
                <div className="phonebook-photo__buttons">
                  <button
                    type="button"
                    className="good-button good-button--subtle"
                    disabled={busy}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <GalleryCircle aria-hidden="true" />
                    {avatar ? t('phonebookDialog.changePhoto') : t('phonebookDialog.addPhoto')}
                  </button>
                  {avatar ? (
                    <button
                      type="button"
                      className="good-button good-button--subtle"
                      disabled={busy}
                      onClick={() => { setPhotoError(''); update({ photo: '' }); }}
                    >
                      {t('phonebookDialog.removePhoto')}
                    </button>
                  ) : null}
                </div>
                <span className="phonebook-hint">{t('phonebookDialog.photoHint')}</span>
                {photoError || fieldError.photo ? (
                  <span className="field-error" role="alert">
                    {photoError || fieldError.photo}
                  </span>
                ) : null}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={(event) => void pickPhoto(event)}
              />
            </div>

            <Field
              id="contact-name"
              label={t('phonebookDialog.name')}
              value={form.name}
              required
              disabled={busy}
              maxLength={CONTACT_NAME_MAX_LENGTH}
              placeholder={t('phonebookDialog.namePlaceholder')}
              error={fieldError.name}
              onChange={(name) => update({ name })}
            />
            <Field
              id="contact-nickname"
              label={t('phonebookDialog.nickname')}
              value={form.nickname}
              disabled={busy}
              placeholder={t('phonebookDialog.nicknamePlaceholder')}
              onChange={(nickname) => update({ nickname })}
            />

            <div className="phonebook-form__grid">
              <CategorySelect
                id="contact-category"
                label={t('phonebookDialog.category')}
                categories={categories}
                value={form.categoryId ?? ''}
                disabled={busy}
                onChange={(categoryId) => update({ categoryId: categoryId || null })}
                onCreate={onCreateCategory}
                onUpdate={onUpdateCategory}
                onDelete={onDeleteCategory}
                onOverlayOpenChange={setCategoryOverlay}
              />
              <Field
                id="contact-tags"
                label={t('phonebookDialog.tags')}
                value={form.tags.join('، ')}
                disabled={busy}
                placeholder={t('phonebookDialog.tagsPlaceholder')}
                hint={t('phonebookDialog.tagsHint')}
                onChange={(value) => update({ tags: parseTagInput(value) })}
              />
            </div>

            <fieldset className="phonebook-choice">
              <legend>{t('phonebookDialog.personality')}</legend>
              <div className="phonebook-choice__row">
                {(['individual', 'legal'] as const).map((value) => (
                  <label key={value} className={`phonebook-choice__option${form.personality === value ? ' is-active' : ''}`}>
                    <input
                      type="radio"
                      name="contact-personality"
                      value={value}
                      checked={form.personality === value}
                      disabled={busy}
                      onChange={() => update({ personality: value })}
                    />
                    <span>{t(`phonebookPersonality.${value}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="phonebook-choice">
              <legend>{t('phonebookDialog.roles')}</legend>
              <div className="phonebook-choice__row phonebook-choice__row--wrap">
                {CONTACT_ROLES.map((role) => (
                  <label key={role} className={`phonebook-choice__option${form.roles.includes(role) ? ' is-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={form.roles.includes(role)}
                      disabled={busy}
                      onChange={() => toggleRole(role)}
                    />
                    <span>{t(`phonebookRole.${role}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="phonebook-flags">
              <SwitchRow
                id="contact-internal"
                title={t('phonebookDialog.internal')}
                checked={form.isInternal}
                disabled={busy}
                onChange={setInternal}
              />
              <SwitchRow
                id="contact-active"
                title={form.isActive ? t('phonebookDialog.active') : t('phonebookDialog.inactive')}
                checked={form.isActive}
                disabled={busy}
                onChange={(isActive) => update({ isActive })}
              />
              <button
                type="button"
                className={`phonebook-favorite${form.isFavorite ? ' is-active' : ''}`}
                aria-pressed={form.isFavorite}
                disabled={busy}
                onClick={() => update({ isFavorite: !form.isFavorite })}
              >
                <span aria-hidden="true">{form.isFavorite ? '★' : '☆'}</span>
                {t('phonebookDialog.favorite')}
              </button>
            </div>

            {!form.isInternal ? (
              <div className="phonebook-form__grid">
                <Field
                  id="contact-company"
                  label={isLegal ? t('phonebookDialog.companyName') : t('phonebookDialog.companyOrOrg')}
                  value={form.companyName}
                  required={isLegal}
                  disabled={busy}
                  placeholder={t('phonebookDialog.companyNamePlaceholder')}
                  error={fieldError.companyName}
                  onChange={(companyName) => update({ companyName })}
                />
                <Field
                  id="contact-position"
                  label={t('phonebookDialog.position')}
                  value={form.jobTitle}
                  disabled={busy}
                  placeholder={t('phonebookDialog.positionPlaceholder')}
                  onChange={(jobTitle) => update({ jobTitle })}
                />
              </div>
            ) : null}

            {isLegal ? (
              <>
                <h3 className="phonebook-form__subhead">{t('phonebookDialog.legalGroup')}</h3>
                <div className="phonebook-form__grid">
                  <Field
                    id="contact-company-type"
                    label={t('phonebookDialog.companyType')}
                    value={form.profile.companyType}
                    disabled={busy}
                    placeholder={t('phonebookDialog.companyTypePlaceholder')}
                    onChange={(companyType) => updateProfile({ companyType })}
                  />
                  <Field
                    id="contact-registration-number"
                    label={t('phonebookDialog.registrationNumber')}
                    value={form.profile.registrationNumber}
                    disabled={busy}
                    dir="ltr"
                    onChange={(registrationNumber) => updateProfile({ registrationNumber })}
                  />
                </div>
                <div className="phonebook-form__grid">
                  <div className="good-field">
                    <DatePicker
                      id="contact-registration-date"
                      label={t('phonebookDialog.registrationDate')}
                      value={form.profile.registrationDate}
                      disabled={busy}
                      errorId={fieldError.registrationDate ? 'contact-registration-date-error' : undefined}
                      onChange={(registrationDate) => updateProfile({ registrationDate })}
                      {...picker('registrationDate')}
                    />
                    <FieldError id="contact-registration-date-error" error={fieldError.registrationDate} />
                  </div>
                  <Field
                    id="contact-national-entity"
                    label={t('phonebookDialog.nationalEntityId')}
                    value={form.profile.nationalEntityId}
                    disabled={busy}
                    dir="ltr"
                    inputMode="numeric"
                    error={fieldError.nationalEntityId}
                    onChange={(nationalEntityId) => updateProfile({ nationalEntityId })}
                  />
                </div>
                <div className="phonebook-form__grid">
                  <Field
                    id="contact-economic-code"
                    label={t('phonebookDialog.economicCode')}
                    value={form.profile.economicCode}
                    disabled={busy}
                    dir="ltr"
                    onChange={(economicCode) => updateProfile({ economicCode })}
                  />
                  <Field
                    id="contact-tax-number"
                    label={t('phonebookDialog.taxNumber')}
                    value={form.profile.taxNumber}
                    disabled={busy}
                    dir="ltr"
                    onChange={(taxNumber) => updateProfile({ taxNumber })}
                  />
                </div>
                <div className="phonebook-form__grid">
                  <Field
                    id="contact-ceo"
                    label={t('phonebookDialog.ceoName')}
                    value={form.profile.ceoName}
                    disabled={busy}
                    onChange={(ceoName) => updateProfile({ ceoName })}
                  />
                  <SelectField
                    id="contact-person"
                    label={t('phonebookDialog.contactPerson')}
                    value={form.profile.contactPersonId}
                    options={contactOptions}
                    disabled={busy}
                    onChange={(contactPersonId) => updateProfile({ contactPersonId })}
                  />
                </div>
              </>
            ) : (
              <>
                <h3 className="phonebook-form__subhead">{t('phonebookDialog.personalGroup')}</h3>
                <div className="phonebook-form__grid">
                  <Field
                    id="contact-first-name"
                    label={t('phonebookDialog.firstName')}
                    value={form.profile.firstName}
                    disabled={busy}
                    onChange={(firstName) => updateProfile({ firstName })}
                  />
                  <Field
                    id="contact-last-name"
                    label={t('phonebookDialog.lastName')}
                    value={form.profile.lastName}
                    disabled={busy}
                    onChange={(lastName) => updateProfile({ lastName })}
                  />
                </div>
                <div className="phonebook-form__grid">
                  <SelectField
                    id="contact-gender"
                    label={t('phonebookDialog.gender')}
                    value={form.profile.gender}
                    disabled={busy}
                    options={CONTACT_GENDERS.map((gender) => ({ value: gender, label: genderLabel(gender) }))}
                    onChange={(gender) => updateProfile({ gender: gender as ContactGender })}
                  />
                  <Field
                    id="contact-father-name"
                    label={t('phonebookDialog.fatherName')}
                    value={form.profile.fatherName}
                    disabled={busy}
                    onChange={(fatherName) => updateProfile({ fatherName })}
                  />
                </div>
                <div className="phonebook-form__grid">
                  <Field
                    id="contact-national-id"
                    label={t('phonebookDialog.nationalId')}
                    value={form.profile.nationalId}
                    disabled={busy}
                    dir="ltr"
                    inputMode="numeric"
                    error={fieldError.nationalId}
                    onChange={(nationalId) => updateProfile({ nationalId })}
                  />
                  <Field
                    id="contact-id-number"
                    label={t('phonebookDialog.idNumber')}
                    value={form.profile.idNumber}
                    disabled={busy}
                    dir="ltr"
                    onChange={(idNumber) => updateProfile({ idNumber })}
                  />
                </div>
                <Field
                  id="contact-id-issue-place"
                  label={t('phonebookDialog.idIssuePlace')}
                  value={form.profile.idIssuePlace}
                  disabled={busy}
                  onChange={(idIssuePlace) => updateProfile({ idIssuePlace })}
                />
              </>
            )}
          </section>
        ) : null}

        {activeTab === 'channels' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-channels" aria-labelledby="contact-tab-channels">
            <div className="phonebook-form__grid">
              <Field
                id="contact-phone"
                label={t('phonebookDialog.phone')}
                value={form.phone}
                disabled={busy}
                dir="ltr"
                inputMode="tel"
                placeholder={t('phonebookDialog.phonePlaceholder')}
                error={fieldError.phone}
                onChange={(phone) => update({ phone })}
              />
              <Field
                id="contact-extension"
                label={t('phonebookDialog.extension')}
                value={form.extension}
                disabled={busy}
                dir="ltr"
                inputMode="tel"
                placeholder={t('phonebookDialog.extensionPlaceholder')}
                onChange={(extension) => update({ extension })}
              />
            </div>

            <div className="phonebook-form__grid">
              <Field
                id="contact-email"
                label={t('phonebookDialog.email')}
                value={form.email}
                disabled={busy}
                dir="ltr"
                type="email"
                placeholder={t('phonebookDialog.emailPlaceholder')}
                error={fieldError.email}
                onChange={(email) => update({ email })}
              />
              <Field
                id="contact-website"
                label={t('phonebookDialog.website')}
                value={form.profile.website}
                disabled={busy}
                dir="ltr"
                placeholder={t('phonebookDialog.websitePlaceholder')}
                error={fieldError.website}
                onChange={(website) => updateProfile({ website })}
              />
            </div>

            <LineEditor
              id="contact-mobiles"
              label={t('phonebookDialog.mobiles')}
              labelPlaceholder={t('phonebookDialog.lineLabelPlaceholder')}
              valuePlaceholder={t('phonebookDialog.mobilePlaceholder')}
              lines={form.profile.mobiles}
              disabled={busy}
              dir="ltr"
              onChange={(mobiles) => updateProfile({ mobiles })}
            />
            <LineEditor
              id="contact-phones"
              label={t('phonebookDialog.phones')}
              labelPlaceholder={t('phonebookDialog.lineLabelPlaceholder')}
              valuePlaceholder={t('phonebookDialog.landlinePlaceholder')}
              lines={form.profile.phones}
              disabled={busy}
              dir="ltr"
              onChange={(phones) => updateProfile({ phones })}
            />
            <LineEditor
              id="contact-faxes"
              label={t('phonebookDialog.faxes')}
              labelPlaceholder={t('phonebookDialog.lineLabelPlaceholder')}
              valuePlaceholder={t('phonebookDialog.faxPlaceholder')}
              lines={form.profile.faxes}
              disabled={busy}
              dir="ltr"
              onChange={(faxes) => updateProfile({ faxes })}
            />

            <MessengerEditor
              entries={form.profile.messengers}
              disabled={busy}
              onChange={(messengers) => updateProfile({ messengers })}
            />
          </section>
        ) : null}

        {activeTab === 'organization' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-organization" aria-labelledby="contact-tab-organization">
            <div className="phonebook-form__grid">
              <Field
                id="contact-organization"
                label={t('phonebookDialog.organization')}
                value={form.organization}
                disabled={busy}
                placeholder={t('phonebookDialog.organizationPlaceholder')}
                onChange={(organization) => update({ organization })}
              />
              <Field
                id="contact-job"
                label={t('phonebookDialog.jobTitle')}
                value={form.jobTitle}
                disabled={busy}
                placeholder={t('phonebookDialog.jobTitlePlaceholder')}
                onChange={(jobTitle) => update({ jobTitle })}
              />
            </div>
            <div className="phonebook-form__grid">
              <Field
                id="contact-personnel-code"
                label={t('phonebookDialog.personnelCode')}
                value={form.profile.personnelCode}
                disabled={busy}
                dir="ltr"
                onChange={(personnelCode) => updateProfile({ personnelCode })}
              />
              <SelectField
                id="contact-manager"
                label={t('phonebookDialog.manager')}
                value={form.profile.managerId}
                options={contactOptions}
                disabled={busy}
                onChange={(managerId) => updateProfile({ managerId })}
              />
            </div>
            <div className="phonebook-form__grid">
              <div className="good-field">
                <DatePicker
                  id="contact-hire-date"
                  label={t('phonebookDialog.hireDate')}
                  value={form.profile.hireDate}
                  disabled={busy}
                  errorId={fieldError.hireDate ? 'contact-hire-date-error' : undefined}
                  onChange={(hireDate) => updateProfile({ hireDate })}
                  {...picker('hireDate')}
                />
                <FieldError id="contact-hire-date-error" error={fieldError.hireDate} />
              </div>
              <Field
                id="contact-shift"
                label={t('phonebookDialog.shift')}
                value={form.profile.shift}
                disabled={busy}
                onChange={(shift) => updateProfile({ shift })}
              />
            </div>
            <div className="phonebook-form__grid phonebook-form__grid--three">
              <Field
                id="contact-building"
                label={t('phonebookDialog.building')}
                value={form.profile.building}
                disabled={busy}
                onChange={(building) => updateProfile({ building })}
              />
              <Field
                id="contact-floor"
                label={t('phonebookDialog.floor')}
                value={form.profile.floor}
                disabled={busy}
                onChange={(floor) => updateProfile({ floor })}
              />
              <Field
                id="contact-room"
                label={t('phonebookDialog.room')}
                value={form.profile.room}
                disabled={busy}
                onChange={(room) => updateProfile({ room })}
              />
            </div>
          </section>
        ) : null}

        {activeTab === 'contractor' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-contractor" aria-labelledby="contact-tab-contractor">
            <div className="phonebook-form__grid">
              <Field
                id="contractor-company"
                label={t('phonebookDialog.contractorCompany')}
                value={form.profile.contractor.company}
                disabled={busy}
                onChange={(company) => updateProfile({ contractor: { ...form.profile.contractor, company } })}
              />
              <Field
                id="contractor-field"
                label={t('phonebookDialog.contractorField')}
                value={form.profile.contractor.field}
                disabled={busy}
                onChange={(field) => updateProfile({ contractor: { ...form.profile.contractor, field } })}
              />
            </div>
            <div className="phonebook-form__grid">
              <Field
                id="contractor-grade"
                label={t('phonebookDialog.contractorGrade')}
                value={form.profile.contractor.grade}
                disabled={busy}
                onChange={(grade) => updateProfile({ contractor: { ...form.profile.contractor, grade } })}
              />
              <Field
                id="contractor-number"
                label={t('phonebookDialog.contractNumber')}
                value={form.profile.contractor.contractNumber}
                disabled={busy}
                dir="ltr"
                onChange={(contractNumber) => updateProfile({ contractor: { ...form.profile.contractor, contractNumber } })}
              />
            </div>
            <div className="phonebook-form__grid">
              <div className="good-field">
                <DatePicker
                  id="contractor-start"
                  label={t('phonebookDialog.contractStart')}
                  value={form.profile.contractor.contractStart}
                  disabled={busy}
                  errorId={fieldError.contractStart ? 'contractor-start-error' : undefined}
                  onChange={(contractStart) => updateProfile({ contractor: { ...form.profile.contractor, contractStart } })}
                  {...picker('contractStart')}
                />
                <FieldError id="contractor-start-error" error={fieldError.contractStart} />
              </div>
              <div className="good-field">
                <DatePicker
                  id="contractor-end"
                  label={t('phonebookDialog.contractEnd')}
                  value={form.profile.contractor.contractEnd}
                  disabled={busy}
                  errorId={fieldError.contractEnd ? 'contractor-end-error' : undefined}
                  onChange={(contractEnd) => updateProfile({ contractor: { ...form.profile.contractor, contractEnd } })}
                  {...picker('contractEnd')}
                />
                <FieldError id="contractor-end-error" error={fieldError.contractEnd} />
              </div>
            </div>
            <div className="phonebook-form__grid">
              <Field
                id="contractor-amount"
                label={t('phonebookDialog.contractAmount')}
                value={form.profile.contractor.contractAmount}
                disabled={busy}
                dir="ltr"
                inputMode="numeric"
                onChange={(contractAmount) => updateProfile({ contractor: { ...form.profile.contractor, contractAmount } })}
              />
              <SelectField
                id="contractor-status"
                label={t('phonebookDialog.contractStatus')}
                value={form.contractStatus}
                disabled={busy}
                options={CONTRACT_STATUSES.map((status) => ({ value: status, label: contractStatusLabel(status) }))}
                onChange={(value) => update({ contractStatus: value as ContactFormDraft['contractStatus'] })}
              />
            </div>
            <div className="phonebook-form__grid">
              <SelectField
                id="contractor-contact"
                label={t('phonebookDialog.contractorContact')}
                value={form.profile.contractor.contactId}
                options={contactOptions}
                disabled={busy}
                onChange={(contactId) => updateProfile({ contractor: { ...form.profile.contractor, contactId } })}
              />
              <Field
                id="contractor-rating"
                label={t('phonebookDialog.contractorRating')}
                value={form.profile.contractor.rating}
                disabled={busy}
                onChange={(rating) => updateProfile({ contractor: { ...form.profile.contractor, rating } })}
              />
            </div>
            <Field
              id="contractor-insurance"
              label={t('phonebookDialog.contractorInsurance')}
              value={form.profile.contractor.insurance}
              disabled={busy}
              onChange={(insurance) => updateProfile({ contractor: { ...form.profile.contractor, insurance } })}
            />
          </section>
        ) : null}

        {activeTab === 'supplier' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-supplier" aria-labelledby="contact-tab-supplier">
            <div className="phonebook-form__grid">
              <Field
                id="supplier-category"
                label={t('phonebookDialog.supplyCategory')}
                value={form.profile.supplier.category}
                disabled={busy}
                onChange={(category) => updateProfile({ supplier: { ...form.profile.supplier, category } })}
              />
              <Field
                id="supplier-brands"
                label={t('phonebookDialog.supplierBrands')}
                value={form.profile.supplier.brands}
                disabled={busy}
                onChange={(brands) => updateProfile({ supplier: { ...form.profile.supplier, brands } })}
              />
            </div>
            <div className="phonebook-form__grid">
              <Field
                id="supplier-payment-terms"
                label={t('phonebookDialog.paymentTerms')}
                value={form.profile.supplier.paymentTerms}
                disabled={busy}
                onChange={(paymentTerms) => updateProfile({ supplier: { ...form.profile.supplier, paymentTerms } })}
              />
              <Field
                id="supplier-settlement-days"
                label={t('phonebookDialog.settlementDays')}
                value={form.profile.supplier.settlementDays}
                disabled={busy}
                dir="ltr"
                inputMode="numeric"
                onChange={(settlementDays) => updateProfile({ supplier: { ...form.profile.supplier, settlementDays } })}
              />
            </div>
            <div className="phonebook-form__grid">
              <Field
                id="supplier-iban"
                label={t('phonebookDialog.iban')}
                value={form.profile.supplier.iban}
                disabled={busy}
                dir="ltr"
                onChange={(iban) => updateProfile({ supplier: { ...form.profile.supplier, iban } })}
              />
              <Field
                id="supplier-bank"
                label={t('phonebookDialog.bank')}
                value={form.profile.supplier.bank}
                disabled={busy}
                onChange={(bank) => updateProfile({ supplier: { ...form.profile.supplier, bank } })}
              />
            </div>
            <div className="phonebook-form__grid phonebook-form__grid--three">
              <Field
                id="supplier-min-order"
                label={t('phonebookDialog.minOrder')}
                value={form.profile.supplier.minOrder}
                disabled={busy}
                onChange={(minOrder) => updateProfile({ supplier: { ...form.profile.supplier, minOrder } })}
              />
              <Field
                id="supplier-delivery-time"
                label={t('phonebookDialog.deliveryTime')}
                value={form.profile.supplier.deliveryTime}
                disabled={busy}
                onChange={(deliveryTime) => updateProfile({ supplier: { ...form.profile.supplier, deliveryTime } })}
              />
              <Field
                id="supplier-delivery-zone"
                label={t('phonebookDialog.deliveryZone')}
                value={form.profile.supplier.deliveryZone}
                disabled={busy}
                onChange={(deliveryZone) => updateProfile({ supplier: { ...form.profile.supplier, deliveryZone } })}
              />
            </div>
          </section>
        ) : null}

        {activeTab === 'address' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-address" aria-labelledby="contact-tab-address">
            <div className="good-field">
              <label htmlFor="contact-address">{t('phonebookDialog.address')}</label>
              <textarea
                id="contact-address"
                className="good-input phonebook-form__address"
                rows={2}
                maxLength={CONTACT_ADDRESS_MAX_LENGTH}
                placeholder={t('phonebookDialog.addressPlaceholder')}
                value={form.address}
                disabled={busy}
                onChange={(event) => update({ address: event.target.value })}
              />
              <span className="phonebook-hint">{t('phonebookDialog.addressHint')}</span>
            </div>

            <AddressEditor
              addresses={form.profile.addresses}
              disabled={busy}
              postalError={fieldError.postalCode}
              onChange={(addresses) => updateProfile({ addresses })}
            />
          </section>
        ) : null}

        {activeTab === 'dates' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-dates" aria-labelledby="contact-tab-dates">
            {!isLegal ? (
              <div className="good-field">
                <DatePicker
                  id="contact-birthday"
                  label={t('phonebookDialog.birthday')}
                  value={form.birthday}
                  disabled={busy}
                  errorId={fieldError.birthday ? 'contact-birthday-error' : undefined}
                  onChange={(birthday) => update({ birthday })}
                  {...picker('birthday')}
                />
                <FieldError id="contact-birthday-error" error={fieldError.birthday} />
              </div>
            ) : null}
            <div className="phonebook-form__grid">
              <div className="good-field">
                <DatePicker
                  id="contact-anniversary"
                  label={t('phonebookDialog.anniversary')}
                  value={form.profile.anniversaryDate}
                  disabled={busy}
                  errorId={fieldError.anniversaryDate ? 'contact-anniversary-error' : undefined}
                  onChange={(anniversaryDate) => updateProfile({ anniversaryDate })}
                  {...picker('anniversaryDate')}
                />
                <FieldError id="contact-anniversary-error" error={fieldError.anniversaryDate} />
              </div>
              <div className="good-field">
                <DatePicker
                  id="contact-last-contact"
                  label={t('phonebookDialog.lastContact')}
                  value={form.profile.lastContactAt}
                  disabled={busy}
                  errorId={fieldError.lastContactAt ? 'contact-last-contact-error' : undefined}
                  onChange={(lastContactAt) => updateProfile({ lastContactAt })}
                  {...picker('lastContactAt')}
                />
                <FieldError id="contact-last-contact-error" error={fieldError.lastContactAt} />
              </div>
            </div>
            <div className="phonebook-form__grid">
              <SelectField
                id="contact-reminder-frequency"
                label={t('phonebookDialog.reminderFrequency')}
                value={form.profile.reminderFrequency}
                disabled={busy}
                options={REMINDER_FREQUENCIES.map((frequency) => ({
                  value: frequency,
                  label: reminderLabel(frequency)
                }))}
                onChange={(reminderFrequency) =>
                  updateProfile({ reminderFrequency: reminderFrequency as ContactFormDraft['profile']['reminderFrequency'] })
                }
              />
              <Field
                id="contact-next-reminder"
                label={t('phonebookDialog.nextReminder')}
                value={form.profile.nextReminderAt}
                disabled={busy}
                placeholder={t('phonebookDialog.nextReminderPlaceholder')}
                onChange={(nextReminderAt) => updateProfile({ nextReminderAt })}
              />
            </div>
            {mode.type === 'edit' ? (
              <div className="phonebook-form__meta">
                <span>{t('phonebookDialog.createdAt')}: {formatIsoDisplay(mode.contact.createdAt.slice(0, 10))}</span>
                <span>{t('phonebookDialog.updatedAt')}: {formatIsoDisplay(mode.contact.updatedAt.slice(0, 10))}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'notes' ? (
          <section className="phonebook-form__panel" role="tabpanel" id="contact-panel-notes" aria-labelledby="contact-tab-notes">
            <div className="good-field">
              <label htmlFor="contact-note">{t('phonebookDialog.note')}</label>
              <textarea
                id="contact-note"
                className="good-input phonebook-form__note"
                rows={4}
                maxLength={CONTACT_NOTE_MAX_LENGTH}
                placeholder={t('phonebookDialog.notePlaceholder')}
                value={form.note}
                disabled={busy}
                onChange={(event) => update({ note: event.target.value })}
              />
            </div>
            <AttachmentEditor
              attachments={form.profile.attachments}
              disabled={busy}
              onChange={(attachments) => updateProfile({ attachments })}
            />
          </section>
        ) : null}
      </form>

      {confirmDelete && mode.type === 'edit' ? (
        <ConfirmDialog
          title={t('phonebookDialog.deleteTitle', { name: mode.contact.name })}
          description={t('common.deleteUnrecoverable')}
          tone="danger"
          confirmLabel={t('common.delete')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </Dialog>
  );
}

function genderLabel(gender: ContactGender): string {
  return t(`phonebookGender.${gender}`);
}

function contractStatusLabel(status: string): string {
  return t(`phonebookContractStatus.${status}`);
}

function reminderLabel(frequency: string): string {
  return t(`phonebookReminder.${frequency}`);
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  type?: string;
  inputMode?: 'tel' | 'numeric' | 'email' | 'text';
  required?: boolean;
  maxLength?: number;
  hint?: string;
};

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  error,
  placeholder,
  dir,
  type = 'text',
  inputMode,
  required,
  maxLength = CONTACT_FIELD_MAX_LENGTH,
  hint
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="good-field">
      {/* The mark is a *sibling* of the label, never a child: anything inside
          the label — even content drawn by CSS — becomes part of the control's
          accessible name, so a screen reader would announce "نام ستاره". */}
      <span className="phonebook-label">
        <label htmlFor={id}>{label}</label>
        {required ? (
          <span className="phonebook-label__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      <input
        id={id}
        className="good-input"
        dir={dir}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && !error ? <span className="phonebook-hint">{hint}</span> : null}
      <FieldError id={errorId} error={error} />
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <span id={id} className="field-error">
      {error}
    </span>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  disabled,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <Select
      id={id}
      label={label}
      options={options}
      value={value}
      searchable={options.length > 8}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function SwitchRow({
  id,
  title,
  checked,
  disabled,
  onChange
}: {
  id: string;
  title: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="phonebook-toggle" htmlFor={id}>
      <span className="phonebook-toggle__control">
        <input
          id={id}
          className="phonebook-toggle__input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="phonebook-toggle__switch" aria-hidden="true" />
      </span>
      <span className="phonebook-toggle__text">
        <span className="phonebook-toggle__title">{title}</span>
      </span>
    </label>
  );
}

function LineEditor({
  id,
  label,
  lines,
  onChange,
  disabled,
  dir,
  labelPlaceholder,
  valuePlaceholder
}: {
  id: string;
  label: string;
  lines: ContactLine[];
  onChange(lines: ContactLine[]): void;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  labelPlaceholder: string;
  valuePlaceholder: string;
}) {
  const full = lines.length >= CONTACT_COLLECTION_MAX;
  function patch(index: number, entry: Partial<ContactLine>) {
    onChange(lines.map((line, position) => (position === index ? { ...line, ...entry } : line)));
  }
  return (
    <fieldset className="phonebook-lines">
      <legend>{label}</legend>
      {lines.map((line, index) => (
        <div className="phonebook-lines__row" key={`${id}-${index}`}>
          <input
            className="good-input phonebook-lines__label"
            placeholder={labelPlaceholder}
            aria-label={`${label} — ${t('phonebookDialog.lineLabel')}`}
            value={line.label}
            disabled={disabled}
            onChange={(event) => patch(index, { label: event.target.value })}
          />
          <input
            className="good-input phonebook-lines__value"
            dir={dir}
            placeholder={valuePlaceholder}
            aria-label={label}
            value={line.value}
            disabled={disabled}
            onChange={(event) => patch(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('phonebookDialog.removeLine', { label })}
            disabled={disabled}
            onClick={() => onChange(lines.filter((_, position) => position !== index))}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="good-button good-button--subtle"
        disabled={disabled || full}
        onClick={() => onChange([...lines, emptyContactLine()])}
      >
        <Plus aria-hidden="true" />
        {t('phonebookDialog.addLine', { label })}
      </button>
    </fieldset>
  );
}

function MessengerEditor({
  entries,
  disabled,
  onChange
}: {
  entries: ContactMessenger[];
  disabled?: boolean;
  onChange(entries: ContactMessenger[]): void;
}) {
  const full = entries.length >= CONTACT_COLLECTION_MAX;
  const options: SelectOption[] = MESSENGER_PLATFORMS.map((platform) => ({
    value: platform,
    label: t(`phonebookMessenger.${platform}`)
  }));
  return (
    <fieldset className="phonebook-lines">
      <legend>{t('phonebookDialog.messengers')}</legend>
      {entries.map((entry, index) => (
        <div className="phonebook-lines__row" key={`messenger-${index}`}>
          <Select
            id={`messenger-platform-${index}`}
            label={t('phonebookDialog.messengerPlatform')}
            hideLabel
            options={options}
            value={entry.platform}
            disabled={disabled}
            onChange={(platform) =>
              onChange(entries.map((item, position) => (position === index ? { ...item, platform } : item)))
            }
          />
          <input
            className="good-input phonebook-lines__value"
            dir="ltr"
            placeholder={t('phonebookDialog.messengerHandle')}
            aria-label={t('phonebookDialog.messengerHandle')}
            value={entry.handle}
            disabled={disabled}
            onChange={(event) =>
              onChange(entries.map((item, position) => (position === index ? { ...item, handle: event.target.value } : item)))
            }
          />
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('phonebookDialog.removeLine', { label: t('phonebookDialog.messengers') })}
            disabled={disabled}
            onClick={() => onChange(entries.filter((_, position) => position !== index))}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="good-button good-button--subtle"
        disabled={disabled || full}
        onClick={() => onChange([...entries, { platform: MESSENGER_PLATFORMS[0], handle: '' }])}
      >
        <Plus aria-hidden="true" />
        {t('phonebookDialog.addMessenger')}
      </button>
    </fieldset>
  );
}

function AddressEditor({
  addresses,
  disabled,
  postalError,
  onChange
}: {
  addresses: ContactAddress[];
  disabled?: boolean;
  postalError?: string;
  onChange(addresses: ContactAddress[]): void;
}) {
  const full = addresses.length >= CONTACT_COLLECTION_MAX;
  function patch(index: number, entry: Partial<ContactAddress>) {
    onChange(addresses.map((address, position) => (position === index ? { ...address, ...entry } : address)));
  }
  return (
    <div className="phonebook-addresses">
      {addresses.map((address, index) => (
        <fieldset className="phonebook-address" key={`address-${index}`}>
          <legend>
            {address.label || t('phonebookDialog.addressNumber', { index: index + 1 })}
            <button
              type="button"
              className="good-icon-button"
              aria-label={t('phonebookDialog.removeAddress')}
              disabled={disabled}
              onClick={() => onChange(addresses.filter((_, position) => position !== index))}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </legend>
          <div className="phonebook-form__grid">
            <Field
              id={`address-label-${index}`}
              label={t('phonebookDialog.addressLabel')}
              value={address.label}
              disabled={disabled}
              placeholder={t('phonebookDialog.addressLabelPlaceholder')}
              onChange={(label) => patch(index, { label })}
            />
            <Field
              id={`address-country-${index}`}
              label={t('phonebookDialog.country')}
              value={address.country}
              disabled={disabled}
              onChange={(country) => patch(index, { country })}
            />
          </div>
          <div className="phonebook-form__grid">
            <Field
              id={`address-province-${index}`}
              label={t('phonebookDialog.province')}
              value={address.province}
              disabled={disabled}
              onChange={(province) => patch(index, { province })}
            />
            <Field
              id={`address-city-${index}`}
              label={t('phonebookDialog.city')}
              value={address.city}
              disabled={disabled}
              onChange={(city) => patch(index, { city })}
            />
          </div>
          <div className="good-field">
            <label htmlFor={`address-full-${index}`}>{t('phonebookDialog.fullAddress')}</label>
            <textarea
              id={`address-full-${index}`}
              className="good-input phonebook-form__address"
              rows={2}
              maxLength={CONTACT_ADDRESS_MAX_LENGTH}
              value={address.fullAddress}
              disabled={disabled}
              onChange={(event) => patch(index, { fullAddress: event.target.value })}
            />
          </div>
          <div className="phonebook-form__grid">
            <Field
              id={`address-postal-${index}`}
              label={t('phonebookDialog.postalCode')}
              value={address.postalCode}
              disabled={disabled}
              dir="ltr"
              inputMode="numeric"
              error={index === 0 ? postalError : undefined}
              onChange={(postalCode) => patch(index, { postalCode })}
            />
            <div className="phonebook-form__grid phonebook-form__grid--pair">
              <Field
                id={`address-lat-${index}`}
                label={t('phonebookDialog.latitude')}
                value={address.latitude}
                disabled={disabled}
                dir="ltr"
                onChange={(latitude) => patch(index, { latitude })}
              />
              <Field
                id={`address-lng-${index}`}
                label={t('phonebookDialog.longitude')}
                value={address.longitude}
                disabled={disabled}
                dir="ltr"
                onChange={(longitude) => patch(index, { longitude })}
              />
            </div>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="good-button good-button--subtle"
        disabled={disabled || full}
        onClick={() => onChange([...addresses, emptyContactAddress()])}
      >
        <Plus aria-hidden="true" />
        {t('phonebookDialog.addAddress')}
      </button>
    </div>
  );
}

function AttachmentEditor({
  attachments,
  disabled,
  onChange
}: {
  attachments: ContactAttachment[];
  disabled?: boolean;
  onChange(attachments: ContactAttachment[]): void;
}) {
  const full = attachments.length >= CONTACT_COLLECTION_MAX;
  function patch(index: number, entry: Partial<ContactAttachment>) {
    onChange(attachments.map((item, position) => (position === index ? { ...item, ...entry } : item)));
  }
  return (
    <fieldset className="phonebook-lines">
      <legend>{t('phonebookDialog.attachments')}</legend>
      {attachments.length === 0 ? <span className="phonebook-hint">{t('phonebookDialog.attachmentsHint')}</span> : null}
      {attachments.map((attachment, index) => (
        <div className="phonebook-lines__row" key={`attachment-${index}`}>
          <input
            className="good-input phonebook-lines__value"
            placeholder={t('phonebookDialog.attachmentName')}
            aria-label={t('phonebookDialog.attachmentName')}
            value={attachment.name}
            disabled={disabled}
            onChange={(event) => patch(index, { name: event.target.value })}
          />
          <input
            className="good-input phonebook-lines__label"
            placeholder={t('phonebookDialog.attachmentKind')}
            aria-label={t('phonebookDialog.attachmentKind')}
            value={attachment.kind}
            disabled={disabled}
            onChange={(event) => patch(index, { kind: event.target.value })}
          />
          <input
            className="good-input phonebook-lines__value"
            dir="ltr"
            placeholder={t('phonebookDialog.attachmentUrl')}
            aria-label={t('phonebookDialog.attachmentUrl')}
            value={attachment.url}
            disabled={disabled}
            onChange={(event) => patch(index, { url: event.target.value })}
          />
          <button
            type="button"
            className="good-icon-button"
            aria-label={t('phonebookDialog.removeLine', { label: t('phonebookDialog.attachments') })}
            disabled={disabled}
            onClick={() => onChange(attachments.filter((_, position) => position !== index))}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="good-button good-button--subtle"
        disabled={disabled || full}
        onClick={() => onChange([...attachments, { name: '', kind: '', url: '' }])}
      >
        <Plus aria-hidden="true" />
        {t('phonebookDialog.addAttachment')}
      </button>
    </fieldset>
  );
}
