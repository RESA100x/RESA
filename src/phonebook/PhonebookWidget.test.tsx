import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { t } from '../i18n';
import { PhonebookWidget } from './PhonebookWidget';
import { createEmptyContactDraft, type Contact, type ContactCategory, type ContactCategoryDraft, type ContactDraft } from './contact-model';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    ...createEmptyContactDraft(),
    id: 'contact-1',
    name: 'رضا احمدی',
    phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹',
    createdAt: 't',
    updatedAt: 't',
    ...overrides
  } as Contact;
}

function category(overrides: Partial<ContactCategory> = {}): ContactCategory {
  return {
    id: 'cat-1',
    name: 'همکاران',
    color: '#4FC9DA',
    position: 0,
    createdAt: 't',
    updatedAt: 't',
    ...overrides
  };
}

function repository(seed: Contact[], seedCategories: ContactCategory[] = []) {
  const store = new Map(seed.map((item) => [item.id, item]));
  const categories = new Map(seedCategories.map((item) => [item.id, item]));
  return {
    listContacts: vi.fn(async () => [...store.values()]),
    createContact: vi.fn(async (draft: ContactDraft) => {
      const created = contact({ id: `contact-${store.size + 1}`, ...draft });
      store.set(created.id, created);
      return created;
    }),
    updateContact: vi.fn(async (id: string, draft: ContactDraft) => {
      const updated = { ...(store.get(id) as Contact), ...draft };
      store.set(id, updated);
      return updated;
    }),
    deleteContact: vi.fn(async (id: string) => {
      store.delete(id);
    }),
    listContactCategories: vi.fn(async () => [...categories.values()]),
    createContactCategory: vi.fn(async (draft: ContactCategoryDraft) => {
      const created = category({ id: `cat-${categories.size + 1}`, ...draft });
      categories.set(created.id, created);
      return created;
    }),
    updateContactCategory: vi.fn(async (id: string, draft: ContactCategoryDraft) => {
      const updated = { ...(categories.get(id) as ContactCategory), ...draft };
      categories.set(id, updated);
      return updated;
    }),
    deleteContactCategory: vi.fn(async (id: string) => {
      // The native promise: the group goes, its contacts stay and lose the link.
      categories.delete(id);
      for (const [key, value] of store) {
        if (value.categoryId === id) store.set(key, { ...value, categoryId: null });
      }
    })
  } as unknown as NowlyRepository;
}

function renderWidget(repo: NowlyRepository, readOnly = false) {
  return render(
    <RepositoryProvider repository={repo}>
      <PhonebookWidget readOnly={readOnly} />
    </RepositoryProvider>
  );
}

async function openPhonebook() {
  await userEvent.click(await screen.findByTestId('phonebook-tile'));
  await screen.findByTestId('phonebook-scroll');
}

const clipboard = { writeText: vi.fn(async () => undefined) };
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  clipboard.writeText.mockClear();
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('PhonebookWidget', () => {
  it('is a one-cell tile that carries the contact count and opens nothing on its own', async () => {
    renderWidget(repository([contact(), contact({ id: 'b', name: 'مینا' })]));
    const tile = await screen.findByTestId('phonebook-tile');
    await waitFor(() => expect(tile).toHaveTextContent('2'));
    expect(screen.queryByTestId('phonebook-scroll')).toBeNull();
    expect(tile).toHaveAccessibleName(t('phonebook.openTile', { count: 2 }));
  });

  it('opens the searchable list in a modal when the tile is clicked', async () => {
    renderWidget(repository([contact(), contact({ id: 'b', name: 'مینا رضایی' })]));
    await openPhonebook();
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByText('رضا احمدی')).toBeInTheDocument();
    expect(within(modal).getByText('مینا رضایی')).toBeInTheDocument();
    // The search field takes focus so the user can type straight away.
    expect(screen.getByRole('searchbox', { name: t('phonebook.search') })).toHaveFocus();
  });

  it('filters the list while typing and reports an empty result honestly', async () => {
    renderWidget(repository([contact(), contact({ id: 'b', name: 'مینا رضایی' })]));
    await openPhonebook();
    const search = screen.getByRole('searchbox', { name: t('phonebook.search') });

    await userEvent.type(search, 'مینا');
    expect(screen.queryByText('رضا احمدی')).toBeNull();
    expect(screen.getByText('مینا رضایی')).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'هیچ‌کس');
    expect(screen.getByText(t('phonebook.noMatch', { query: 'هیچ‌کس' }))).toBeInTheDocument();
    expect(screen.queryByText('مینا رضایی')).toBeNull();
  });

  it('adds a contact from the modal and starts it empty before any list exists', async () => {
    const repo = repository([]);
    renderWidget(repo);
    await openPhonebook();
    expect(await screen.findByText(t('phonebook.empty'))).toBeInTheDocument();

    // The header button and the empty-state button share one label; the header
    // one comes first in the DOM.
    await userEvent.click(screen.getAllByRole('button', { name: t('phonebook.add') })[0]);
    await userEvent.type(screen.getByLabelText(t('phonebookDialog.name')), 'سارا کریمی');
    // "Works here" is a decision taken on the identity tab; the organisation
    // tab only exists because of it.
    await userEvent.click(screen.getByLabelText(t('phonebookDialog.internal')));
    await userEvent.click(screen.getByRole('tab', { name: t('phonebookTab.channels') }));
    await userEvent.type(screen.getByLabelText(t('phonebookDialog.phone')), '021-8899');
    await userEvent.type(screen.getByLabelText(t('phonebookDialog.extension')), '1012');
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.saveContact') }));

    await waitFor(() => expect(repo.createContact).toHaveBeenCalledTimes(1));
    expect(repo.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'سارا کریمی', phone: '021-8899', extension: '1012', isInternal: true })
    );
    expect(await screen.findByText('سارا کریمی')).toBeInTheDocument();
  });

  it('refuses to save a contact with no name', async () => {
    const repo = repository([contact()]);
    renderWidget(repo);
    await openPhonebook();
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.add') }));
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.saveContact') }));
    expect(await screen.findByText(t('phonebookDialog.errorName'))).toBeInTheDocument();
    expect(repo.createContact).not.toHaveBeenCalled();
  });

  it('edits and deletes a contact', async () => {
    const repo = repository([contact()]);
    renderWidget(repo);
    await openPhonebook();

    await userEvent.click(screen.getByRole('button', { name: t('phonebook.edit', { name: 'رضا احمدی' }) }));
    const nameField = screen.getByLabelText(t('phonebookDialog.name'));
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'رضا احمدی‌نژاد');
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.saveContact') }));
    await waitFor(() => expect(repo.updateContact).toHaveBeenCalledWith('contact-1', expect.objectContaining({ name: 'رضا احمدی‌نژاد' })));
    expect(await screen.findByText('رضا احمدی‌نژاد')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: t('phonebook.edit', { name: 'رضا احمدی‌نژاد' }) }));
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.deleteContact') }));
    await userEvent.click(screen.getByRole('button', { name: t('common.delete') }));
    await waitFor(() => expect(repo.deleteContact).toHaveBeenCalledWith('contact-1'));
    expect(await screen.findByText(t('phonebook.empty'))).toBeInTheDocument();
  });

  it('shows only colleagues on the "internal" tab, extension first', async () => {
    renderWidget(
      repository([
        contact({ id: 'a', name: 'سارا کریمی', extension: '۱۰۱۲', jobTitle: 'کارشناس شبکه', organization: 'فناوری اطلاعات', isInternal: true }),
        contact({ id: 'b', name: 'مینا رضایی' })
      ])
    );
    await openPhonebook();

    await userEvent.click(screen.getByRole('tab', { name: new RegExp(t('phonebook.tab.internal')) }));
    expect(screen.getByText('سارا کریمی')).toBeInTheDocument();
    expect(screen.getByText(t('phonebook.extensionShort', { extension: '۱۰۱۲' }))).toBeInTheDocument();
    expect(screen.queryByText('مینا رضایی')).toBeNull();
    // The per-row copy button is the one that gets used; there is no bulk
    // "copy every extension" button in this tab.
    expect(screen.queryByRole('button', { name: t('phonebook.copyInternal') })).toBeNull();
  });

  it('grows the organisation tab only once the person is a colleague', async () => {
    renderWidget(repository([contact()]));
    await openPhonebook();
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.add') }));

    // Unit, position and personnel code are meaningless for an outsider, so the
    // whole tab is absent rather than shown empty.
    expect(screen.queryByRole('tab', { name: t('phonebookTab.organization') })).toBeNull();

    await userEvent.click(screen.getByLabelText(t('phonebookDialog.internal')));
    await userEvent.click(await screen.findByRole('tab', { name: t('phonebookTab.organization') }));
    expect(screen.getByLabelText(t('phonebookDialog.jobTitle'))).toBeEnabled();
    expect(screen.getByLabelText(t('phonebookDialog.personnelCode'))).toBeEnabled();

    // Turning the switch off takes the tab away again, and the form falls back
    // to the identity tab rather than showing an empty panel.
    await userEvent.click(screen.getByRole('tab', { name: t('phonebookTab.identity') }));
    await userEvent.click(screen.getByLabelText(t('phonebookDialog.internal')));
    expect(screen.queryByRole('tab', { name: t('phonebookTab.organization') })).toBeNull();
    expect(screen.getByLabelText(t('phonebookDialog.name'))).toBeEnabled();
  });

  it('keeps a stored extension visible and editable', async () => {
    const repo = repository([contact({ extension: '۱۰۱۲', isInternal: true })]);
    renderWidget(repo);
    await openPhonebook();
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.edit', { name: 'رضا احمدی' }) }));

    expect(screen.getByLabelText(t('phonebookDialog.internal'))).toBeChecked();
    await userEvent.click(screen.getByRole('tab', { name: t('phonebookTab.channels') }));
    const extension = screen.getByLabelText(t('phonebookDialog.extension'));
    expect(extension).toHaveValue('۱۰۱۲');
    expect(extension).toBeEnabled();
  });

  it('draws the picture a contact carries, and keeps the picture after an edit', async () => {
    const photo = 'data:image/jpeg;base64,QUJD';
    const repo = repository([contact({ id: 'a', name: 'سارا کریمی', photo })]);
    renderWidget(repo);
    await openPhonebook();

    const row = await screen.findByTestId('phonebook-row-a');
    expect(row.querySelector('img')).toHaveAttribute('src', photo);

    // The form seeds from the stored picture and sends it back untouched.
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.edit', { name: 'سارا کریمی' }) }));
    expect(screen.getByRole('button', { name: t('phonebookDialog.changePhoto') })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.removePhoto') }));
    await userEvent.click(screen.getByRole('button', { name: t('phonebookDialog.saveContact') }));
    await waitFor(() => expect(repo.updateContact).toHaveBeenCalledWith('a', expect.objectContaining({ photo: '' })));
  });

  it('offers a photo the contact does not have yet', async () => {
    renderWidget(repository([contact({ id: 'a' })]));
    await openPhonebook();
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.edit', { name: 'رضا احمدی' }) }));
    expect(screen.getByRole('button', { name: t('phonebookDialog.addPhoto') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('phonebookDialog.removePhoto') })).toBeNull();
  });

  it('copies a colleague\'s line so it can be handed to whoever asked', async () => {
    renderWidget(repository([contact({ id: 'a', name: 'سارا کریمی', extension: '۱۰۱۲', isInternal: true })]));
    await openPhonebook();

    await userEvent.click(screen.getByRole('button', { name: t('phonebook.copyPhone', { name: 'سارا کریمی' }) }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('۱۰۱۲'));
    const row = await screen.findByTestId('phonebook-row-a');
    expect(await within(row).findByText(t('phonebook.copied'))).toBeInTheDocument();
  });

  it('creates and deletes a group without touching the contacts in it', async () => {
    const repo = repository([contact({ categoryId: 'cat-1' })], [category()]);
    renderWidget(repo);
    await openPhonebook();

    await userEvent.click(screen.getByRole('tab', { name: t('phonebook.tab.groups') }));
    expect(await screen.findByTestId('phonebook-group-cat-1')).toBeInTheDocument();
    expect(screen.getByTestId('phonebook-group-cat-1')).toHaveTextContent('همکاران');

    // Create a second group through the inline editor.
    await userEvent.click(screen.getByRole('button', { name: t('phonebook.groups.add') }));
    await userEvent.type(screen.getByPlaceholderText(t('category.namePlaceholder')), 'خانواده');
    await userEvent.click(screen.getByRole('button', { name: t('category.add') }));
    await waitFor(() => expect(repo.createContactCategory).toHaveBeenCalledWith({ name: 'خانواده', color: '#4FC9DA' }));

    // Deleting a group keeps its contacts.
    await userEvent.click(screen.getByRole('button', { name: t('category.delete', { name: 'همکاران' }) }));
    const confirmations = screen.getAllByRole('dialog');
    await userEvent.click(within(confirmations[confirmations.length - 1]).getByRole('button', { name: t('category.deleteConfirm') }));
    await waitFor(() => expect(repo.deleteContactCategory).toHaveBeenCalledWith('cat-1'));
    await userEvent.click(screen.getByRole('tab', { name: t('phonebook.tab.all') }));
    expect(screen.getByText('رضا احمدی')).toBeInTheDocument();
  });

  it('reports a backend that is missing the command, with a retry action', async () => {
    renderWidget({} as NowlyRepository);
    await openPhonebook();
    expect(await screen.findByText(t('phonebook.unavailable', { command: 'listContacts' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('common.retry') })).toBeInTheDocument();
  });

  it('keeps the tile but opens no modal when the block is read-only', async () => {
    renderWidget(repository([contact()]), true);
    const tile = await screen.findByTestId('phonebook-tile');
    expect(tile).toBeDisabled();
    await userEvent.click(tile);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
