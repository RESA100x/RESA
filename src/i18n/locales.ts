export const SUPPORTED_LANGUAGES = ['zh', 'en', 'fa', 'fr', 'es', 'ja', 'ko', 'zh-Hant'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export const LOCALES: Record<Language, { name: string; locale: string; lang: string; dir: 'ltr' | 'rtl' }> = {
  zh: { name: '简体中文', locale: 'zh-CN', lang: 'zh-Hans', dir: 'ltr' },
  en: { name: 'English', locale: 'en-US', lang: 'en', dir: 'ltr' },
  fa: { name: 'فارسی', locale: 'fa-IR', lang: 'fa', dir: 'rtl' },
  fr: { name: 'Français', locale: 'fr-FR', lang: 'fr', dir: 'ltr' },
  es: { name: 'Español', locale: 'es-ES', lang: 'es', dir: 'ltr' },
  ja: { name: '日本語', locale: 'ja-JP', lang: 'ja', dir: 'ltr' },
  ko: { name: '한국어', locale: 'ko-KR', lang: 'ko', dir: 'ltr' },
  'zh-Hant': { name: '繁體中文', locale: 'zh-TW', lang: 'zh-Hant', dir: 'ltr' }
};

export function matchLanguage(tag: string | undefined | null): Language | null {
  const parts = tag?.trim().replace(/_/g, '-').toLowerCase().split('-');
  if (!parts?.[0]) return null;
  if (parts[0] === 'zh') {
    if (parts.includes('hans')) return 'zh';
    if (parts.includes('hant') || parts.some(part => ['tw', 'hk', 'mo'].includes(part))) return 'zh-Hant';
    return 'zh';
  }
  // Persian is matched from the primary subtag so `fa-IR`, `fa_AF` and `fa`
  // all resolve to the same dictionary.
  if (parts[0] === 'fa') return 'fa';
  return SUPPORTED_LANGUAGES.find(language => language === parts[0]) ?? null;
}

export function normalizeLanguage(tag: string | undefined | null): Language {
  return matchLanguage(tag) ?? 'en';
}
