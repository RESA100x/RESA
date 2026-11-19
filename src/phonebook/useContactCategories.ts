import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { ContactCategory, ContactCategoryDraft } from './contact-model';

export type ContactCategoriesResource = {
  status: 'loading' | 'ready' | 'error';
  data: ContactCategory[];
  message?: string;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('phonebook.readError');
}

function missing(command: string) {
  return new Error(t('phonebook.unavailable', { command }));
}

/**
 * Groups load alongside the contacts but never block the list: a build whose
 * repository has no group commands simply shows an empty group list and the
 * contacts stay fully usable — the phone book must keep working as a phone book
 * even before anyone defines a group.
 */
export function useContactCategories() {
  const repository = useNowlyRepository();
  const [categories, setCategories] = useState<ContactCategoriesResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const readCategories = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setCategories((current) => ({ status: 'loading', data: current.data }));
    const read = repository.listContactCategories;
    if (!read) {
      // No group support in this repository: an empty list, not an error.
      if (requestId === requestIdRef.current) setCategories({ status: 'ready', data: [] });
      return;
    }
    try {
      const data = await read.call(repository);
      if (requestId === requestIdRef.current) setCategories({ status: 'ready', data: data.map((category) => ({ ...category })) });
    } catch (error) {
      if (!silent && requestId === requestIdRef.current) {
        setCategories((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);
  const loadCategories = useCallback(() => readCategories(false), [readCategories]);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const createCategory = useCallback(async (draft: ContactCategoryDraft) => {
    const write = repository.createContactCategory;
    if (!write) throw missing('createContactCategory');
    const created = await write.call(repository, draft);
    await loadCategories();
    return created;
  }, [loadCategories, repository]);

  const updateCategory = useCallback(async (id: string, draft: ContactCategoryDraft) => {
    const write = repository.updateContactCategory;
    if (!write) throw missing('updateContactCategory');
    const updated = await write.call(repository, id, draft);
    await loadCategories();
    return updated;
  }, [loadCategories, repository]);

  const deleteCategory = useCallback(async (id: string) => {
    const write = repository.deleteContactCategory;
    if (!write) throw missing('deleteContactCategory');
    await write.call(repository, id);
    await loadCategories();
  }, [loadCategories, repository]);

  return { categories, reloadCategories: loadCategories, createCategory, updateCategory, deleteCategory };
}
