/// <reference types="vite/client" />

// Injected at build time from package.json by vite.config.ts.
declare const __APP_VERSION__: string;

// Injected at build time from resa.config.json by vite.config.ts. The repository
// is empty when this build has no configured release source.
declare const __RESA_REPO__: string;
declare const __RESA_FEEDBACK_EMAIL__: string;

interface Window {
  readonly __NOWLY_SYSTEM_LANGUAGE__?: string | null;
}
