// Form ⇄ draft conversion and validation, kept symmetrical with
// `src-tauri/src/contacts.rs`. The error keys are the same field names the Rust
// side reports ("name", "nationalId", "postalCode"…), so a validation error
// coming back from either side lands on the same input.
//
// Only the display name is required for a person. A legal person also needs its
// company name, and every contact needs at least one way to reach them — a
// directory entry with no number at all is not worth keeping.

import { t } from '../i18n';
import {
  CONTACT_ADDRESS_MAX_LENGTH,
  CONTACT_COLLECTION_MAX,
  CONTACT_NOTE_MAX_LENGTH,
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  REMINDER_FREQUENCIES,
  createEmptyContactDraft,
  digitsOnly,
  foldDigits,
  isContactPhoto,
  isEmailAddress,
  isIsoDate,
  isLegalEntityId,
  isNationalId,
  isPostalCode,
  isWebsiteUrl,
  normalizeContactField,
  normalizeContactName,
  normalizeContactPhoto,
  normalizeIsoDate,
  todayIso,
  type Contact,
  type ContactAddress,
  type ContactAttachment,
  type ContactDraft,
  type ContactGender,
  type ContactLine,
  type ContactMessenger,
  type ContactProfile,
  type ContactRole,
  type ContractStatus,
  type ContractorInfo,
  type ReminderFrequency,
  type SupplierInfo
} from './contact-model';

export type ContactFormDraft = ContactDraft;
/** Keyed by the field name both this module and the Rust backend report. */
export type ContactFieldErrors = Partial<Record<string, string>>;

export function createContactForm(): ContactFormDraft {
  return createEmptyContactDraft();
}

/**
 * Accept whatever arrived (a stored row from an older build, a payload from the
 * browser shim) and hand back a complete draft. Every field is present, so the
 * form and the validators never have to guard one that "should" be there.
 */
export function coerceContactDraft(input: unknown): ContactFormDraft {
  const base = createEmptyContactDraft();
  if (typeof input !== 'object' || input === null) return base;
  const row = input as Partial<ContactDraft> & { profile?: Partial<ContactProfile> };
  return {
    ...base,
    ...row,
    roles: Array.isArray(row.roles) ? row.roles : base.roles,
    tags: Array.isArray(row.tags) ? row.tags : base.tags,
    personality: row.personality === 'legal' ? 'legal' : 'individual',
    categoryId: row.categoryId ?? null,
    profile: { ...base.profile, ...(row.profile ?? {}) }
  };
}

export function contactToForm(contact: Contact): ContactFormDraft {
  return {
    name: contact.name,
    nickname: contact.nickname,
    personality: contact.personality,
    roles: [...contact.roles],
    isInternal: contact.isInternal,
    isFavorite: contact.isFavorite,
    isActive: contact.isActive,
    tags: [...contact.tags],
    photo: contact.photo,
    phone: contact.phone,
    extension: contact.extension,
    organization: contact.organization,
    jobTitle: contact.jobTitle,
    companyName: contact.companyName,
    email: contact.email,
    address: contact.address,
    birthday: contact.birthday,
    categoryId: contact.categoryId,
    contractStatus: contact.contractStatus,
    note: contact.note,
    profile: cloneProfile(contact.profile)
  };
}

function cloneProfile(profile: ContactProfile): ContactProfile {
  return {
    ...profile,
    mobiles: profile.mobiles.map((line) => ({ ...line })),
    phones: profile.phones.map((line) => ({ ...line })),
    faxes: profile.faxes.map((line) => ({ ...line })),
    extensions: profile.extensions.map((line) => ({ ...line })),
    emails: profile.emails.map((line) => ({ ...line })),
    messengers: profile.messengers.map((line) => ({ ...line })),
    addresses: profile.addresses.map((address) => ({ ...address })),
    attachments: profile.attachments.map((attachment) => ({ ...attachment })),
    contractor: { ...profile.contractor },
    supplier: { ...profile.supplier }
  };
}

/** Any line with a value in it, across the channels a contact can be reached on. */
function hasAnyChannel(form: ContactFormDraft): boolean {
  const filled = (lines: ContactLine[]) => lines.some((line) => line.value.trim() !== '');
  return (
    form.phone.trim() !== '' ||
    form.extension.trim() !== '' ||
    form.email.trim() !== '' ||
    filled(form.profile.mobiles) ||
    filled(form.profile.phones) ||
    filled(form.profile.emails) ||
    form.profile.messengers.some((entry) => entry.handle.trim() !== '')
  );
}

export function validateContactForm(form: ContactFormDraft): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  if (!normalizeContactName(form.name)) errors.name = t('phonebookDialog.errorName');
  if (form.personality === 'legal' && !normalizeContactField(form.companyName)) {
    errors.companyName = t('phonebookDialog.errorCompanyName');
  }
  if (!hasAnyChannel(form)) errors.phone = t('phonebookDialog.errorChannel');

  // The picker hands over an ISO date; a hand-typed one has to survive the same
  // check, with local digits (۱۹۹۰-۰۵-۱۲) folded to ASCII first.
  const birthday = normalizeIsoDate(form.birthday);
  if (form.birthday.trim() && !birthday) errors.birthday = t('phonebookDialog.errorBirthday');
  else if (birthday && birthday > todayIso()) errors.birthday = t('phonebookDialog.errorFutureDate');

  // An avatar that arrived from somewhere other than the picker (a paste, a
  // restored backup from a newer version) must not be written unvalidated.
  if (form.photo && !isContactPhoto(form.photo)) errors.photo = t('phonebookDialog.photoError');
  if (form.email.trim() && !isEmailAddress(form.email)) errors.email = t('phonebookDialog.errorEmail');

  const profile = form.profile;
  if (profile.nationalId.trim() && !isNationalId(profile.nationalId)) {
    errors.nationalId = t('phonebookDialog.errorNationalId');
  }
  if (profile.nationalEntityId.trim() && !isLegalEntityId(profile.nationalEntityId)) {
    errors.nationalEntityId = t('phonebookDialog.errorLegalEntityId');
  }
  if (profile.website.trim() && !isWebsiteUrl(profile.website)) {
    errors.website = t('phonebookDialog.errorWebsite');
  }
  for (const [key, value] of [
    ['registrationDate', profile.registrationDate],
    ['anniversaryDate', profile.anniversaryDate],
    ['hireDate', profile.hireDate],
    ['lastContactAt', profile.lastContactAt],
    ['contractStart', profile.contractor.contractStart],
    ['contractEnd', profile.contractor.contractEnd]
  ] as const) {
    const normalized = normalizeIsoDate(value);
    if (value.trim() && !normalized) {
      errors[key] = t('phonebookDialog.errorDate');
      continue;
    }
    // A birthday and a registration date describe the past; hire and contract
    // dates may legitimately be in the future.
    const mustBePast = key === 'registrationDate' || key === 'anniversaryDate' || key === 'lastContactAt';
    if (mustBePast && normalized && normalized > todayIso()) {
      errors[key] = t('phonebookDialog.errorFutureDate');
    }
  }

  for (const address of profile.addresses) {
    if (address.postalCode.trim() && !isPostalCode(address.postalCode)) {
      errors.postalCode = t('phonebookDialog.errorPostalCode');
      break;
    }
  }

  return errors;
}

function normalizeLines(lines: ContactLine[]): ContactLine[] {
  const out: ContactLine[] = [];
  for (const line of lines) {
    const value = normalizeContactField(line.value);
    if (!value) continue;
    out.push({ label: normalizeContactField(line.label, 30), value });
    if (out.length >= CONTACT_COLLECTION_MAX) break;
  }
  return out;
}

function normalizeMobileLines(lines: ContactLine[]): ContactLine[] {
  return normalizeLines(lines).map((line) => {
    const digits = digitsOnly(line.value);
    return digits ? { label: line.label, value: digits } : line;
  });
}

function normalizeMessengers(entries: ContactMessenger[]): ContactMessenger[] {
  const out: ContactMessenger[] = [];
  for (const entry of entries) {
    const platform = normalizeContactField(entry.platform, 30);
    const handle = normalizeContactField(entry.handle);
    if (!platform && !handle) continue;
    out.push({ platform, handle });
    if (out.length >= CONTACT_COLLECTION_MAX) break;
  }
  return out;
}

function normalizeAddresses(addresses: ContactAddress[]): ContactAddress[] {
  const out: ContactAddress[] = [];
  for (const address of addresses) {
    const entry: ContactAddress = {
      label: normalizeContactField(address.label, 30),
      country: normalizeContactField(address.country),
      province: normalizeContactField(address.province),
      city: normalizeContactField(address.city),
      fullAddress: normalizeContactField(address.fullAddress, CONTACT_ADDRESS_MAX_LENGTH),
      postalCode: digitsOnly(address.postalCode),
      latitude: normalizeContactField(address.latitude, 40),
      longitude: normalizeContactField(address.longitude, 40)
    };
    const blank =
      !entry.label &&
      !entry.country &&
      !entry.province &&
      !entry.city &&
      !entry.fullAddress &&
      !entry.postalCode;
    if (blank) continue;
    out.push(entry);
    if (out.length >= CONTACT_COLLECTION_MAX) break;
  }
  return out;
}

function normalizeAttachments(attachments: ContactAttachment[]): ContactAttachment[] {
  const out: ContactAttachment[] = [];
  for (const attachment of attachments) {
    const name = normalizeContactField(attachment.name);
    if (!name) continue;
    out.push({
      name,
      kind: normalizeContactField(attachment.kind, 30),
      url: attachment.url.trim().slice(0, 2048)
    });
    if (out.length >= CONTACT_COLLECTION_MAX) break;
  }
  return out;
}

function normalizeRoles(roles: readonly string[]): ContactRole[] {
  const out: ContactRole[] = [];
  for (const role of roles) {
    if (CONTACT_ROLES.includes(role as ContactRole) && !out.includes(role as ContactRole)) {
      out.push(role as ContactRole);
    }
  }
  return out;
}

function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const item = normalizeContactField(tag, 30);
    if (!item || out.includes(item)) continue;
    out.push(item);
    if (out.length >= CONTACT_COLLECTION_MAX) break;
  }
  return out;
}

function normalizeEnumValue<T extends string>(value: string, allowed: readonly T[]): T | '' {
  return allowed.includes(value as T) ? (value as T) : '';
}

function normalizeContractor(contractor: ContractorInfo): ContractorInfo {
  return {
    company: normalizeContactField(contractor.company),
    field: normalizeContactField(contractor.field),
    grade: normalizeContactField(contractor.grade, 60),
    contractNumber: normalizeContactField(contractor.contractNumber, 60),
    contractStart: normalizeIsoDate(contractor.contractStart),
    contractEnd: normalizeIsoDate(contractor.contractEnd),
    contractAmount: normalizeContactField(contractor.contractAmount, 40),
    contactId: normalizeContactField(contractor.contactId, 64),
    insurance: normalizeContactField(contractor.insurance),
    rating: normalizeContactField(contractor.rating, 20)
  };
}

function normalizeSupplier(supplier: SupplierInfo): SupplierInfo {
  return {
    category: normalizeContactField(supplier.category),
    brands: normalizeContactField(supplier.brands),
    paymentTerms: normalizeContactField(supplier.paymentTerms),
    settlementDays: normalizeContactField(supplier.settlementDays, 20),
    iban: normalizeContactField(supplier.iban, 40).toUpperCase(),
    bank: normalizeContactField(supplier.bank),
    minOrder: normalizeContactField(supplier.minOrder, 40),
    deliveryTime: normalizeContactField(supplier.deliveryTime, 60),
    deliveryZone: normalizeContactField(supplier.deliveryZone, 60)
  };
}

function normalizeProfile(profile: ContactProfile): ContactProfile {
  return {
    firstName: normalizeContactField(profile.firstName),
    lastName: normalizeContactField(profile.lastName),
    gender: normalizeEnumValue<Exclude<ContactGender, ''>>(profile.gender, ['male', 'female', 'other']),
    fatherName: normalizeContactField(profile.fatherName),
    nationalId: digitsOnly(profile.nationalId),
    idNumber: normalizeContactField(profile.idNumber, 30),
    idIssuePlace: normalizeContactField(profile.idIssuePlace),
    companyType: normalizeContactField(profile.companyType),
    registrationNumber: normalizeContactField(profile.registrationNumber, 40),
    registrationDate: normalizeIsoDate(profile.registrationDate),
    nationalEntityId: digitsOnly(profile.nationalEntityId),
    economicCode: normalizeContactField(profile.economicCode, 40),
    taxNumber: normalizeContactField(profile.taxNumber, 40),
    ceoName: normalizeContactField(profile.ceoName),
    contactPersonId: normalizeContactField(profile.contactPersonId, 64),
    mobiles: normalizeMobileLines(profile.mobiles),
    phones: normalizeLines(profile.phones),
    faxes: normalizeLines(profile.faxes),
    extensions: normalizeLines(profile.extensions),
    emails: normalizeLines(profile.emails),
    messengers: normalizeMessengers(profile.messengers),
    website: normalizeContactField(profile.website),
    personnelCode: normalizeContactField(profile.personnelCode, 40),
    managerId: normalizeContactField(profile.managerId, 64),
    hireDate: normalizeIsoDate(profile.hireDate),
    building: normalizeContactField(profile.building),
    floor: normalizeContactField(profile.floor, 30),
    room: normalizeContactField(profile.room, 30),
    shift: normalizeContactField(profile.shift, 60),
    contractor: normalizeContractor(profile.contractor),
    supplier: normalizeSupplier(profile.supplier),
    addresses: normalizeAddresses(profile.addresses),
    anniversaryDate: normalizeIsoDate(profile.anniversaryDate),
    lastContactAt: normalizeIsoDate(profile.lastContactAt),
    nextReminderAt: normalizeContactField(profile.nextReminderAt, 40),
    reminderFrequency: normalizeEnumValue<Exclude<ReminderFrequency, ''>>(
      profile.reminderFrequency,
      REMINDER_FREQUENCIES
    ),
    attachments: normalizeAttachments(profile.attachments)
  };
}

export function toContactDraft(form: ContactFormDraft): ContactDraft {
  return {
    name: normalizeContactName(form.name),
    nickname: normalizeContactField(form.nickname),
    personality: form.personality === 'legal' ? 'legal' : 'individual',
    roles: normalizeRoles(form.roles),
    isInternal: form.isInternal,
    isFavorite: form.isFavorite,
    isActive: form.isActive,
    tags: normalizeTags(form.tags),
    photo: normalizeContactPhoto(form.photo),
    phone: normalizeContactField(form.phone),
    extension: normalizeContactField(form.extension),
    organization: normalizeContactField(form.organization),
    jobTitle: normalizeContactField(form.jobTitle),
    companyName: normalizeContactField(form.companyName),
    email: normalizeContactField(form.email),
    address: normalizeContactField(form.address, CONTACT_ADDRESS_MAX_LENGTH),
    birthday: normalizeIsoDate(form.birthday),
    categoryId: form.categoryId || null,
    contractStatus: normalizeEnumValue<Exclude<ContractStatus, ''>>(form.contractStatus, CONTRACT_STATUSES),
    note: normalizeContactField(form.note, CONTACT_NOTE_MAX_LENGTH),
    profile: normalizeProfile(form.profile)
  };
}

export function isContactFormDirty(initial: ContactFormDraft, current: ContactFormDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

/** Split the tag input on the separators a Persian keyboard produces. */
export function parseTagInput(value: string): string[] {
  return foldDigits(value)
    .split(/[,،\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function isRealDate(value: string): boolean {
  return isIsoDate(normalizeIsoDate(value));
}
