import { contactCategoryName, type Contact, type ContactCategory } from './contact-model';

// Searching a phone book has to be forgiving about the way the same number is
// written. A contact saved from a Persian keyboard is full of Persian digits
// (۰۹۱۲), one typed on a laptop is full of Latin ones (0912), and the two must
// find each other. The same goes for the Arabic letter variants that a
// different keyboard produces: ي/ك have to match ی/ک.
const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const ARABIC_DIACRITICS = /[\u064B-\u0655\u0670]/g;
// Letters that differ per keyboard, plus the presentation forms NFKC folds
// back here (ﻻ, ﮐ ...) once they are normalised.
const LETTER_FOLD: Array<[RegExp, string]> = [
  [/[\u0643\u06A9]/g, '\u06A9'],
  [/[\u0649\u064A\u06CC]/g, '\u06CC'],
  [/[\u0629\u06C0]/g, '\u0647']
];
const SEPARATORS = /[\s()+\-–—_.,;:/\\]/g;

/**
 * Fold a value so two spellings of the same contact compare equal: digits to
 * Latin, Arabic letter variants to their Persian form, ZWNJ to a space, and
 * case to lower.
 */
export function foldForSearch(value: string): string {
  let folded = value.normalize('NFKC');
  folded = folded.replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  folded = folded.replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660));
  folded = folded.replace(ARABIC_DIACRITICS, '');
  for (const [pattern, replacement] of LETTER_FOLD) folded = folded.replace(pattern, replacement);
  return folded
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dense(value: string): string {
  return value.replace(SEPARATORS, '');
}

/**
 * Everything a row can be found by: the name and the two numbers first,
 * followed by the fields a directory is actually searched for — the office
 * extension, the department, the job title, the email, the address, the group,
 * the tags, the company, the national id, the messenger handles and the note.
 */
export function contactSearchText(contact: Contact, categoryName = ''): string {
  const profile = contact.profile;
  return foldForSearch(
    [
      contact.name,
      contact.nickname,
      contact.phone,
      contact.extension,
      contact.organization,
      contact.jobTitle,
      contact.companyName,
      contact.email,
      contact.address,
      contact.tags.join(' '),
      categoryName,
      contact.note,
      profile.firstName,
      profile.lastName,
      profile.fatherName,
      profile.nationalId,
      profile.idNumber,
      profile.personnelCode,
      profile.website,
      ...profile.mobiles.map((line) => line.value),
      ...profile.phones.map((line) => line.value),
      ...profile.faxes.map((line) => line.value),
      ...profile.extensions.map((line) => line.value),
      ...profile.emails.map((line) => line.value),
      ...profile.messengers.map((entry) => entry.handle),
      ...profile.addresses.map((address) =>
        [address.city, address.province, address.country, address.fullAddress, address.postalCode].join(' ')
      ),
      profile.contractor.company,
      profile.contractor.contractNumber,
      profile.supplier.category,
      profile.supplier.brands,
      profile.supplier.bank,
      profile.supplier.iban
    ].join(' ')
  );
}

/**
 * Match a query against the whole row. The fallback pass drops the separators
 * on both sides, so "۰۹۱۲۳۴۵" finds a number stored as "۰۹۱۲ ۳۴۵ ۶۷۸۹" and
 * extension "1012" is found by "10-12".
 */
export function contactMatchesQuery(contact: Contact, query: string, categoryName = ''): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  const haystack = contactSearchText(contact, categoryName);
  if (haystack.includes(needle)) return true;
  return dense(haystack).includes(dense(needle));
}

/**
 * Filter by the free-text query. `categories` is optional so a caller that has
 * not loaded the groups yet still gets name/number matching.
 */
export function filterContacts(
  contacts: Contact[],
  query: string,
  categories: readonly ContactCategory[] = []
): Contact[] {
  if (!foldForSearch(query)) return contacts;
  return contacts.filter((contact) =>
    contactMatchesQuery(contact, query, contactCategoryName(contact.categoryId, categories))
  );
}
