import { useCallback, useEffect, useRef, useState } from 'react';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';
import type { Contact, ContactDraft, ContactsExportSummary, ContactsImportSummary } from './contact-model';

export type ContactsResource = {
  status: 'loading' | 'ready' | 'error';
  data: Contact[];
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

export function useContacts() {
  const repository = useNowlyRepository();
  const [contacts, setContacts] = useState<ContactsResource>({ status: 'loading', data: [] });
  const requestIdRef = useRef(0);

  const readContacts = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setContacts((current) => ({ status: 'loading', data: current.data }));
    try {
      const write = repository.listContacts;
      if (!write) throw missing('listContacts');
      const data = await write.call(repository);
      // Copy the rows: a backend that answers with the same array instance (a
      // cache, a shim) would otherwise hand the module the rows it already
      // holds, and the memoized search results would keep showing the old list.
      if (requestId === requestIdRef.current) setContacts({ status: 'ready', data: data.map((contact) => ({ ...contact })) });
    } catch (error) {
      // A silent refresh keeps what is on screen; only an explicit read reports
      // the failure, exactly like the notes and plants modules.
      if (!silent && requestId === requestIdRef.current) {
        setContacts((current) => ({ status: 'error', data: current.data, message: messageFrom(error) }));
      }
    }
  }, [repository]);
  const loadContacts = useCallback(() => readContacts(false), [readContacts]);

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const createContact = useCallback(async (draft: ContactDraft) => {
    const write = repository.createContact;
    if (!write) throw missing('createContact');
    const created = await write.call(repository, draft);
    await loadContacts();
    return created;
  }, [loadContacts, repository]);

  const updateContact = useCallback(async (contact: Contact, draft: ContactDraft) => {
    const write = repository.updateContact;
    if (!write) throw missing('updateContact');
    const updated = await write.call(repository, contact.id, draft);
    await loadContacts();
    return updated;
  }, [loadContacts, repository]);

  const deleteContact = useCallback(async (contact: Contact) => {
    const write = repository.deleteContact;
    if (!write) throw missing('deleteContact');
    await write.call(repository, contact.id);
    await loadContacts();
  }, [loadContacts, repository]);

  const exportContacts = useCallback(async (path: string): Promise<ContactsExportSummary> => {
    const write = repository.exportContacts;
    if (!write) throw missing('exportContacts');
    return write.call(repository, path);
  }, [repository]);

  const importContacts = useCallback(async (path: string, commit: boolean): Promise<ContactsImportSummary> => {
    const write = repository.importContacts;
    if (!write) throw missing('importContacts');
    const summary = await write.call(repository, path, commit);
    if (commit) await loadContacts();
    return summary;
  }, [loadContacts, repository]);

  // A build whose repository has no CSV commands simply hides the transfer
  // buttons; the directory itself keeps working either way.
  const canTransfer = Boolean(repository.exportContacts && repository.importContacts);

  return {
    contacts,
    reload: loadContacts,
    createContact,
    updateContact,
    deleteContact,
    exportContacts,
    importContacts,
    canTransfer
  };
}
