// The phone book, kept symmetrical with `src-tauri/src/contacts.rs`.
//
// A contact is either a person or a company, it can hold several roles at once
// (a colleague who is also a manager), and everything that is worth filtering
// on has a real field here while the long tail lives in `profile`. The same
// shape travels unchanged between the Rust table and the browser shim, and the
// validation below mirrors the Rust checks so a form that saves here saves
// there too.
//
// Groups ("دسته‌بندی") are user records that own a name and a colour, exactly
// like the calendar's categories: a contact only stores `categoryId`, so a
// group's colour is never snapshotted onto its contacts and renaming a group
// recolours every row at once. Deleting a group must never delete a contact.

import type { HexColor } from '../lib/color';

export const CONTACT_NAME_MAX_LENGTH = 80;
export const CONTACT_FIELD_MAX_LENGTH = 200;
export const CONTACT_ADDRESS_MAX_LENGTH = 300;
export const CONTACT_NOTE_MAX_LENGTH = 400;
/** The avatar is downscaled before it is stored, so it normally weighs a few KB. */
export const CONTACT_PHOTO_MAX_LENGTH = 64 * 1024;
/** Longest edge of the stored avatar, in pixels. */
export const CONTACT_PHOTO_MAX_EDGE = 128;
/** Each multi-value list (phones, emails, addresses…) keeps at most this many rows. */
export const CONTACT_COLLECTION_MAX = 20;

export type ContactPersonality = 'individual' | 'legal';
export const CONTACT_PERSONALITIES: readonly ContactPersonality[] = ['individual', 'legal'];

export type ContactRole = 'colleague' | 'contractor' | 'manager' | 'supplier' | 'customer' | 'other';
export const CONTACT_ROLES: readonly ContactRole[] = [
  'colleague',
  'contractor',
  'manager',
  'supplier',
  'customer',
  'other'
];

export type ContactGender = '' | 'male' | 'female' | 'other';
export const CONTACT_GENDERS: readonly Exclude<ContactGender, ''>[] = ['male', 'female', 'other'];

export type ContractStatus = '' | 'active' | 'expired' | 'suspended';
export const CONTRACT_STATUSES: readonly Exclude<ContractStatus, ''>[] = ['active', 'expired', 'suspended'];

export type ReminderFrequency = '' | 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const REMINDER_FREQUENCIES: readonly Exclude<ReminderFrequency, ''>[] = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'yearly'
];

/** Messenger ids a Persian-speaking office actually uses. */
export const MESSENGER_PLATFORMS: readonly string[] = [
  'whatsapp',
  'telegram',
  'bale',
  'eitaa',
  'soroush',
  'skype'
];

/** A labelled value: "اصلی: ۰۹۱۲…", "محل کار: ۰۲۱…". */
export type ContactLine = {
  label: string;
  value: string;
};

export type ContactMessenger = {
  platform: string;
  handle: string;
};

export type ContactAddress = {
  label: string;
  country: string;
  province: string;
  city: string;
  fullAddress: string;
  postalCode: string;
  latitude: string;
  longitude: string;
};

export type ContactAttachment = {
  name: string;
  kind: string;
  url: string;
};

export type ContractorInfo = {
  company: string;
  field: string;
  grade: string;
  contractNumber: string;
  contractStart: string;
  contractEnd: string;
  contractAmount: string;
  contactId: string;
  insurance: string;
  rating: string;
};

export type SupplierInfo = {
  category: string;
  brands: string;
  paymentTerms: string;
  settlementDays: string;
  iban: string;
  bank: string;
  minOrder: string;
  deliveryTime: string;
  deliveryZone: string;
};

/**
 * The long tail: everything that is edited in the form but rarely filtered on.
 * Stored as one JSON blob so adding a field never needs a database migration.
 */
export type ContactProfile = {
  firstName: string;
  lastName: string;
  gender: ContactGender;
  fatherName: string;
  nationalId: string;
  idNumber: string;
  idIssuePlace: string;
  companyType: string;
  registrationNumber: string;
  registrationDate: string;
  nationalEntityId: string;
  economicCode: string;
  taxNumber: string;
  ceoName: string;
  contactPersonId: string;
  mobiles: ContactLine[];
  phones: ContactLine[];
  faxes: ContactLine[];
  extensions: ContactLine[];
  emails: ContactLine[];
  messengers: ContactMessenger[];
  website: string;
  personnelCode: string;
  managerId: string;
  hireDate: string;
  building: string;
  floor: string;
  room: string;
  shift: string;
  contractor: ContractorInfo;
  supplier: SupplierInfo;
  addresses: ContactAddress[];
  anniversaryDate: string;
  lastContactAt: string;
  nextReminderAt: string;
  reminderFrequency: ReminderFrequency;
  attachments: ContactAttachment[];
};

export type Contact = {
  id: string;
  /** Display name — required for both a person and a company. */
  name: string;
  /** Nickname or brand. */
  nickname: string;
  personality: ContactPersonality;
  roles: ContactRole[];
  /** Marked as a colleague, so the "internal lines" tab can list them alone. */
  isInternal: boolean;
  isFavorite: boolean;
  isActive: boolean;
  tags: string[];
  /**
   * A small inline avatar (`data:image/...;base64,...`), '' when the contact has
   * no picture. Stored inline so the photo travels with its contact: deleting
   * the contact removes the picture, and no file has to be cleaned up.
   */
  photo: string;
  /** Primary number, the one a row shows first. */
  phone: string;
  /** Office extension; '' when the contact has none. */
  extension: string;
  /** Department for a colleague, or the organisation for anyone else. */
  organization: string;
  /** Job title for a colleague, or the position for anyone else. */
  jobTitle: string;
  /** Company name — required for a legal person. */
  companyName: string;
  email: string;
  address: string;
  /**
   * 'YYYY-MM-DD', Gregorian; '' when unset. Stored in the Gregorian calendar
   * (the date itself never shifts) and rendered through the local calendar, so
   * a Persian user reads the Jalali date with no conversion in the data.
   */
  birthday: string;
  categoryId: string | null;
  contractStatus: ContractStatus;
  note: string;
  profile: ContactProfile;
  createdAt: string;
  updatedAt: string;
};

export type ContactDraft = Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>;

export type ContactCategory = {
  id: string;
  name: string;
  color: HexColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ContactCategoryDraft = {
  name: string;
  color: HexColor;
};

/** What `exportContacts` wrote: the file and how many rows went into it. */
export type ContactsExportSummary = {
  path: string;
  contacts: number;
};

/**
 * The dry-run/commit result of importing a CSV. `commit: false` reports what
 * *would* happen, so the UI can show a preview before anything is written.
 */
export type ContactsImportSummary = {
  /** Data rows read from the file, header excluded. */
  read: number;
  /** Rows importable; when the preview ran, rows that *would* be written. */
  imported: number;
  /** Rows with no name, no channel, or a failed check. */
  skipped: number;
  /** Rows already stored (same name and number), so never written twice. */
  duplicated: number;
};

const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// The exact shape the Rust side accepts, so a photo that saves here saves there.
const PHOTO_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Persian and Arabic digits typed on a local keyboard become ASCII digits. */
export function foldDigits(value: string): string {
  return value
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/** Fold the local digits, then keep the digits alone — separators dropped. */
export function digitsOnly(value: string): string {
  return foldDigits(value).replace(/\D+/g, '');
}

// Collapse the whitespace a paste brings along: a number copied as
// "۰۹۱۲  ۳۴۵ ۶۷۸۹" should read back on one line. Truncation counts characters
// rather than code units, so a Persian name is never cut mid-word.
export function normalizeContactField(value: unknown, max: number = CONTACT_FIELD_MAX_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeContactName(value: unknown): string {
  return normalizeContactField(value, CONTACT_NAME_MAX_LENGTH);
}

/** True only for a real calendar date, so 1990-02-31 is rejected. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Any date field is either '' or a real ISO date; local digits folded first. */
export function normalizeIsoDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const folded = foldDigits(value).trim().replace(/\//g, '-');
  return isIsoDate(folded) ? folded : '';
}

/** Today in the local calendar, as 'YYYY-MM-DD'. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** True only for a stored-size inline image; '' (no picture) is not one. */
export function isContactPhoto(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CONTACT_PHOTO_MAX_LENGTH &&
    PHOTO_URL.test(value)
  );
}

/** Keep a valid inline avatar, drop anything else ('' means "no picture"). */
export function normalizeContactPhoto(value: unknown): string {
  return isContactPhoto(value) ? value : '';
}

/**
 * Iran's national ID: ten digits whose last one is a checksum. All-same digits
 * (1111111111) pass the arithmetic but are not real, so they are rejected too.
 */
export function isNationalId(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return false;
  const numbers = digits.split('').map(Number);
  if (numbers.every((digit) => digit === numbers[0])) return false;
  const sum = numbers
    .slice(0, 9)
    .reduce((total, digit, index) => total + digit * (10 - index), 0);
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return numbers[9] === check;
}

/** Legal-entity id: eleven digits. */
export function isLegalEntityId(value: string): boolean {
  return digitsOnly(value).length === 11;
}

/** A mobile number is eleven digits starting with 09. */
export function isMobileNumber(value: string): boolean {
  return /^09\d{9}$/.test(digitsOnly(value));
}

export function isPostalCode(value: string): boolean {
  return digitsOnly(value).length === 10;
}

/** `local@domain.tld` — the same shape the Rust side checks. */
export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.includes('.') && !/\s/.test(trimmed);
}

/** A website is either a full URL or a bare domain; no spaces either way. */
export function isWebsiteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('.');
}

export function emptyContactLine(): ContactLine {
  return { label: '', value: '' };
}

export function emptyContactAddress(): ContactAddress {
  return {
    label: '',
    country: '',
    province: '',
    city: '',
    fullAddress: '',
    postalCode: '',
    latitude: '',
    longitude: ''
  };
}

export function emptyContractorInfo(): ContractorInfo {
  return {
    company: '',
    field: '',
    grade: '',
    contractNumber: '',
    contractStart: '',
    contractEnd: '',
    contractAmount: '',
    contactId: '',
    insurance: '',
    rating: ''
  };
}

export function emptySupplierInfo(): SupplierInfo {
  return {
    category: '',
    brands: '',
    paymentTerms: '',
    settlementDays: '',
    iban: '',
    bank: '',
    minOrder: '',
    deliveryTime: '',
    deliveryZone: ''
  };
}

export function emptyContactProfile(): ContactProfile {
  return {
    firstName: '',
    lastName: '',
    gender: '',
    fatherName: '',
    nationalId: '',
    idNumber: '',
    idIssuePlace: '',
    companyType: '',
    registrationNumber: '',
    registrationDate: '',
    nationalEntityId: '',
    economicCode: '',
    taxNumber: '',
    ceoName: '',
    contactPersonId: '',
    mobiles: [],
    phones: [],
    faxes: [],
    extensions: [],
    emails: [],
    messengers: [],
    website: '',
    personnelCode: '',
    managerId: '',
    hireDate: '',
    building: '',
    floor: '',
    room: '',
    shift: '',
    contractor: emptyContractorInfo(),
    supplier: emptySupplierInfo(),
    addresses: [],
    anniversaryDate: '',
    lastContactAt: '',
    nextReminderAt: '',
    reminderFrequency: '',
    attachments: []
  };
}

/** A brand-new contact: an active private individual with nothing filled in. */
export function createEmptyContactDraft(): ContactDraft {
  return {
    name: '',
    nickname: '',
    personality: 'individual',
    roles: [],
    isInternal: false,
    isFavorite: false,
    isActive: true,
    tags: [],
    photo: '',
    phone: '',
    extension: '',
    organization: '',
    jobTitle: '',
    companyName: '',
    email: '',
    address: '',
    birthday: '',
    categoryId: null,
    contractStatus: '',
    note: '',
    profile: emptyContactProfile()
  };
}

/**
 * Fill in whatever a stored row is missing. The browser shim and an older
 * database both hand back rows written before a field existed; reading them
 * through here means the UI never has to guard a field that "should" be there.
 */
export function withContactDefaults(row: Partial<Contact> & { id: string }): Contact {
  const profile = { ...emptyContactProfile(), ...(row.profile ?? {}) };
  const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
  return {
    id: row.id,
    name: text(row.name),
    nickname: text(row.nickname),
    personality: row.personality === 'legal' ? 'legal' : 'individual',
    roles: Array.isArray(row.roles) ? ([...row.roles] as ContactRole[]) : [],
    isInternal: Boolean(row.isInternal),
    isFavorite: Boolean(row.isFavorite),
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    photo: text(row.photo),
    phone: text(row.phone),
    extension: text(row.extension),
    organization: text(row.organization),
    jobTitle: text(row.jobTitle),
    companyName: text(row.companyName),
    email: text(row.email),
    address: text(row.address),
    birthday: text(row.birthday),
    categoryId: row.categoryId ?? null,
    contractStatus: text(row.contractStatus) as ContractStatus,
    note: text(row.note),
    profile: {
      ...profile,
      mobiles: Array.isArray(profile.mobiles) ? profile.mobiles : [],
      phones: Array.isArray(profile.phones) ? profile.phones : [],
      faxes: Array.isArray(profile.faxes) ? profile.faxes : [],
      extensions: Array.isArray(profile.extensions) ? profile.extensions : [],
      emails: Array.isArray(profile.emails) ? profile.emails : [],
      messengers: Array.isArray(profile.messengers) ? profile.messengers : [],
      addresses: Array.isArray(profile.addresses) ? profile.addresses : [],
      attachments: Array.isArray(profile.attachments) ? profile.attachments : [],
      contractor: { ...emptyContractorInfo(), ...(profile.contractor ?? {}) },
      supplier: { ...emptySupplierInfo(), ...(profile.supplier ?? {}) }
    },
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  };
}

/** Resolve a group id to its name using the loaded list; '' when unknown. */
export function contactCategoryName(
  categoryId: string | null,
  categories: readonly ContactCategory[]
): string {
  if (!categoryId) return '';
  return categories.find((category) => category.id === categoryId)?.name ?? '';
}
