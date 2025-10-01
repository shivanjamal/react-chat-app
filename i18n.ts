import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';

// Define a generic type for translations since we can no longer infer it from a static import.
type Translations = { [key: string]: string };
type Language = 'en' | 'es';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, replacements?: { [key: string]: string }) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');
  const [translations, setTranslations] = useState<{ en: Translations, es: Translations } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTranslations = async () => {
      try {
        const [enResponse, esResponse] = await Promise.all([
          fetch('./locales/en.json'),
          fetch('./locales/es.json')
        ]);
        if (!enResponse.ok || !esResponse.ok) {
            throw new Error('Failed to fetch translation files');
        }
        const en = await enResponse.json();
        const es = await esResponse.json();
        setTranslations({ en, es });
      } catch (error) {
        console.error("Failed to load translations:", error);
      } finally {
        setLoading(false);
      }
    };

    loadTranslations();
  }, []); // Empty dependency array ensures this runs only once on mount

  const t = (key: string, replacements?: { [key: string]: string }): string => {
    if (!translations) {
      return key; // Return the key as a fallback if translations aren't loaded
    }
    
    let translation = translations[language][key] || translations['en'][key] || key;
    
    if (replacements) {
      Object.keys(replacements).forEach(rKey => {
        translation = translation.replace(new RegExp(`{{${rKey}}}`, 'g'), replacements[rKey]);
      });
    }
    return translation;
  };

  if (loading) {
    return null; // Render nothing until translations are loaded to prevent errors
  }

  // Using React.createElement because this is a .ts file, not .tsx
  return React.createElement(I18nContext.Provider, { value: { language, setLanguage, t } }, children);
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};