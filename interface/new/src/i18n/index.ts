import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from './en/common.json';
import esCommon from './es/common.json';
import nestClient from '../api/nest-client';

/**
 * Initialize i18next with server-configured language.
 * On startup, fetches /api/config to determine the configured language.
 * Falls back to browser detection, then English.
 */

const resources = {
  en: { common: enCommon },
  es: { common: esCommon },
};

async function getServerLanguage(): Promise<string> {
  try {
    const r = await nestClient.get('/config');
    return r.data?.language || 'en';
  } catch {
    return 'en';
  }
}

export async function initI18n(): Promise<typeof i18n> {
  const serverLang = await getServerLanguage();

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      lng: serverLang,
      fallbackLng: 'en',
      ns: ['common'],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    });

  // Force the server-configured language
  if (serverLang !== i18n.language) {
    await i18n.changeLanguage(serverLang);
  }

  return i18n;
}

export default i18n;
