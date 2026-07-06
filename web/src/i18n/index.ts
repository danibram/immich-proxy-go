import { createSignal } from 'solid-js';
import { en, type Messages } from './en';
import { es } from './es';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

const dictionaries: Record<Locale, Messages> = { en, es };

const STORAGE_KEY = 'ipp-locale';

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve the initial locale: an explicit stored choice (set via the homepage
 * selector) wins; otherwise fall back to the browser's language, then English.
 */
function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage may be unavailable (private mode); fall through.
  }

  const candidates = typeof navigator !== 'undefined' ? [navigator.language, ...(navigator.languages ?? [])] : [];
  for (const candidate of candidates) {
    const primary = candidate?.split('-')[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale());

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale();
}

/** The current locale (reactive). */
export { locale };

/**
 * The active message dictionary (reactive). Reading `t()` inside JSX or a
 * memo subscribes to locale changes, so the UI re-renders on switch.
 */
export function t(): Messages {
  return dictionaries[locale()];
}

/** Switch locale and persist the choice. Used by the homepage selector. */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore persistence failures (private mode); the in-memory signal still updates.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
}
