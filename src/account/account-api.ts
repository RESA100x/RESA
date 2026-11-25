import { invoke } from '@tauri-apps/api/core';

export type UserProfile = {
  fullName: string;
  birthDate: string | null;
  nationalId: string;
  phone: string;
  email: string;
  jobTitle: string;
  organization: string;
  address: string;
  bio: string;
  /** Data URL, or empty when no picture is set. */
  avatar: string;
  updatedAt: string | null;
};

export type ProfileDraft = Omit<UserProfile, 'updatedAt'>;

export type VaultStatus = {
  initialized: boolean;
  unlocked: boolean;
  documentCount: number;
  totalBytes: number;
};

export type VaultDocument = {
  id: string;
  title: string;
  category: string;
  docNumber: string;
  issuedAt: string | null;
  expiresAt: string | null;
  tags: string;
  notes: string;
  fileName: string;
  mime: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
};

export type VaultDraft = {
  title: string;
  category: string;
  docNumber: string;
  issuedAt: string | null;
  expiresAt: string | null;
  tags: string;
  notes: string;
};

export type VaultFile = { mime: string; fileName: string; base64: string };

export type VaultExport = { path: string; count: number };

export const VAULT_CATEGORIES = [
  'identity',
  'education',
  'insurance',
  'contract',
  'financial',
  'medical',
  'other'
] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

export const accountApi = {
  profile: () => invoke<UserProfile>('profile_get'),
  saveProfile: (draft: ProfileDraft) => invoke<UserProfile>('profile_save', { draft }),
  exportVcard: () => invoke<string>('profile_export_vcard', { dest: null }),

  vaultStatus: () => invoke<VaultStatus>('vault_status'),
  vaultSetup: (pin: string, hint: string) => invoke<VaultStatus>('vault_setup', { pin, hint }),
  vaultUnlock: (pin: string) => invoke<VaultStatus>('vault_unlock', { pin }),
  vaultLock: () => invoke<void>('vault_lock'),
  vaultChangePin: (oldPin: string, newPin: string) =>
    invoke<void>('vault_change_pin', { oldPin, newPin }),
  vaultList: () => invoke<VaultDocument[]>('vault_list_documents'),
  vaultPickFiles: () => invoke<string[]>('vault_pick_files'),
  vaultImport: (path: string, draft: VaultDraft) =>
    invoke<VaultDocument>('vault_import_document', { path, draft }),
  // The phone picker returns a File, not a path, so the bytes travel through
  // IPC instead. Same vault, same encryption; only the transport differs.
  vaultImportBytes: (fileName: string, mime: string, base64: string, draft: VaultDraft) =>
    invoke<VaultDocument>('vault_import_document_bytes', { fileName, mime, base64, draft }),
  vaultUpdate: (id: string, draft: VaultDraft) =>
    invoke<VaultDocument>('vault_update_document', { id, draft }),
  vaultDelete: (ids: string[]) => invoke<number>('vault_delete_documents', { ids }),
  vaultRead: (id: string) => invoke<VaultFile>('vault_read_document', { id }),
  vaultSaveCopy: (id: string) => invoke<string>('vault_save_copy', { id, dest: null }),
  vaultExportZip: (ids: string[]) => invoke<VaultExport>('vault_export_zip', { ids, dest: null }),
  vaultOpen: (id: string) => invoke<void>('vault_open_document', { id })
};

export function emptyVaultDraft(title = ''): VaultDraft {
  return {
    title,
    category: 'other',
    docNumber: '',
    issuedAt: null,
    expiresAt: null,
    tags: '',
    notes: ''
  };
}

export function draftOf(document: VaultDocument): VaultDraft {
  return {
    title: document.title,
    category: document.category,
    docNumber: document.docNumber,
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    tags: document.tags,
    notes: document.notes
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
