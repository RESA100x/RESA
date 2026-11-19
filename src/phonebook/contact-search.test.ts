import { describe, expect, it } from 'vitest';
import { contactMatchesQuery, contactSearchText, filterContacts } from './contact-search';
import { createEmptyContactDraft, type Contact, type ContactCategory } from './contact-model';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    ...createEmptyContactDraft(),
    id: 'contact-1',
    name: 'رضا احمدی',
    phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹',
    extension: '۱۰۱۲',
    organization: 'فناوری اطلاعات',
    jobTitle: 'کارشناس شبکه',
    email: 'reza@company.ir',
    address: 'تهران، خیابان آزادی',
    birthday: '1990-05-12',
    categoryId: 'work',
    isInternal: true,
    note: 'شمارهٔ دفتر',
    createdAt: 't',
    updatedAt: 't',
    ...overrides
  } as Contact;
}

const categories: ContactCategory[] = [
  { id: 'work', name: 'همکاران', color: '#4FC9DA', position: 0, createdAt: 't', updatedAt: 't' }
];

describe('phone book search', () => {
  it('matches a Persian name by any part of it', () => {
    expect(contactMatchesQuery(contact(), 'احمدی')).toBe(true);
    expect(contactMatchesQuery(contact(), 'رضا')).toBe(true);
    expect(contactMatchesQuery(contact(), 'مینا')).toBe(false);
  });

  it('finds a Persian-digit number typed with Latin digits', () => {
    // The contact was saved from a Persian keyboard (۰۹۱۲…), the search box may
    // hold Latin digits typed on a laptop (0912…), and the two must meet.
    expect(contactMatchesQuery(contact(), '0912')).toBe(true);
    expect(contactMatchesQuery(contact(), '۰۹۱۲')).toBe(true);
  });

  it('ignores the separators inside a phone number', () => {
    expect(contactMatchesQuery(contact(), '0912345')).toBe(true);
    expect(contactMatchesQuery(contact(), '+49 30 1234')).toBe(false);
    expect(contactMatchesQuery(contact({ phone: '+49 30 1234' }), '49301234')).toBe(true);
  });

  it('folds the Arabic letter variants a different keyboard produces', () => {
    // "ي"/"ك" instead of "ی"/"ک", as an Arabic keyboard would type it.
    expect(contactMatchesQuery(contact({ name: 'كامران' }), 'کامران')).toBe(true);
    expect(contactMatchesQuery(contact({ name: 'كامران' }), 'كامران')).toBe(true);
    expect(contactMatchesQuery(contact({ name: 'علي' }), 'علی')).toBe(true);
  });

  it('searches every directory field, not just the name and number', () => {
    // This is what makes it a directory: "who is our network engineer?" and
    // "what is Maryam's extension?" are answered from the search box.
    expect(contactMatchesQuery(contact(), 'شبکه')).toBe(true); // job title
    expect(contactMatchesQuery(contact(), 'فناوری')).toBe(true); // organisation
    expect(contactMatchesQuery(contact(), 'reza@company')).toBe(true); // email
    expect(contactMatchesQuery(contact(), 'آزادی')).toBe(true); // address
    expect(contactMatchesQuery(contact(), 'دفتر')).toBe(true); // note
    expect(contactMatchesQuery(contact(), '1012')).toBe(true); // extension, Latin digits
  });

  it('treats a blank query as "show everything"', () => {
    const rows = [contact(), contact({ id: 'b', name: 'مینا' })];
    expect(filterContacts(rows, '')).toHaveLength(2);
    expect(filterContacts(rows, '   ')).toHaveLength(2);
    expect(filterContacts(rows, 'مینا')).toHaveLength(1);
    expect(filterContacts(rows, 'هیچ‌کس')).toHaveLength(0);
  });

  it('finds a contact by the name of its group', () => {
    // The group name lives on the group, not on the contact, so the caller has
    // to hand the loaded groups in.
    expect(filterContacts([contact()], 'همکاران', categories)).toHaveLength(1);
    expect(filterContacts([contact()], 'خانواده', categories)).toHaveLength(0);
  });

  it('indexes the group name only when it is supplied', () => {
    expect(contactSearchText(contact(), 'همکاران')).toContain('همکاران');
    expect(contactSearchText(contact())).not.toContain('همکاران');
  });
});
