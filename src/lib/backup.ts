export type BackupSummary = {
  path: string;
  attachments: number;
  byteSize: number;
  safetyCopy: string | null;
};

/** Header inside a `.resa` archive, read before an import replaces anything. */
export type BackupManifest = {
  format: string;
  version: number;
  appVersion: string;
  createdAt: string;
  attachments: number;
};
