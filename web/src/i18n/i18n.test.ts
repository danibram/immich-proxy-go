import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import { LOCALE_NAMES, locale, setLocale, SUPPORTED_LOCALES, t } from './index';

// Collect the shape of a dictionary as a set of dotted paths, tagging each
// leaf as a string or a function so we catch a value that changed kind.
function shape(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [`${prefix}:fn`];
  if (Array.isArray(value)) return value.flatMap((v, i) => shape(v, `${prefix}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  }
  return [`${prefix}:str`];
}

describe('i18n', () => {
  afterEach(() => setLocale('en'));

  it('exposes English and Spanish', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(LOCALE_NAMES.en).toBe('English');
    expect(LOCALE_NAMES.es).toBe('Español');
  });

  it('the Spanish dictionary has exactly the same shape as English', () => {
    // TS enforces this at compile time; this guards translated arrays (features/
    // security items) whose length or leaf kinds could silently drift.
    expect(shape(es).sort()).toEqual(shape(en).sort());
  });

  it('setLocale switches the active dictionary reactively', () => {
    setLocale('en');
    expect(locale()).toBe('en');
    expect(t().common.today).toBe('Today');
    expect(t().password.unlock).toBe('Unlock album');

    setLocale('es');
    expect(locale()).toBe('es');
    expect(t().common.today).toBe('Hoy');
    expect(t().password.unlock).toBe('Desbloquear álbum');
  });

  it('pluralizes counts per language', () => {
    setLocale('en');
    expect(t().topbar.itemCount(1)).toBe('1 item');
    expect(t().topbar.itemCount(3)).toBe('3 items');

    setLocale('es');
    expect(t().topbar.itemCount(1)).toBe('1 elemento');
    expect(t().topbar.itemCount(3)).toBe('3 elementos');
    expect(t().topbar.selected(1)).toBe('1 seleccionado');
    expect(t().topbar.selected(2)).toBe('2 seleccionados');
  });

  it('persists the chosen locale', () => {
    setLocale('es');
    expect(localStorage.getItem('ipp-locale')).toBe('es');
  });
});
