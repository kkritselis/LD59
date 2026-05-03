/**
 * TranslationManager
 *
 * Loads translations.csv, exposes the language list, and provides
 * getText() for looking up localized strings by STRING ID.
 *
 * CSV shape (row 0 = header, row 1 = LANGUAGE_CODE, row 2 = LANGUAGE_EN, row 3 = LANGUAGE_DIRECTION)
 * Column 0 = STRING ID, columns 1‥N = one language each.
 *
 * Selected language is persisted to localStorage under 'se_language'.
 */

const STORAGE_KEY = 'se_language';

/**
 * Minimal CSV parser that handles quoted fields containing commas.
 * Returns a 2-D array of strings.
 */
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        cells.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

export class TranslationManager {
  constructor() {
    /**
     * Ordered list of available languages.
     * @type {Array<{key: string, name: string, direction: string, code: string, columnIndex: number}>}
     */
    this.languages = [];

    /**
     * Flat lookup: stringId -> object mapping language key -> translated string.
     * @type {Object<string, Object<string, string>>}
     */
    this._strings = {};

    /** The currently selected language key (LANGUAGE_EN value e.g. "English"). */
    this.selectedLanguage = null;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Fetches and parses translations.csv.
   * Restores a previously saved language from localStorage.
   * @returns {Promise<void>}
   */
  async load() {
    let text;
    try {
      const res = await fetch('translations.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.error('[TranslationManager] Failed to load translations.csv:', err);
      this._setFallback();
      return;
    }

    const rows = parseCSV(text);
    if (rows.length < 4) {
      console.warn('[TranslationManager] translations.csv has too few rows');
      this._setFallback();
      return;
    }

    const headerRow    = rows[0]; // STRING ID, ENGLISH, SIMPLIFIED CHINESE...
    const codeRow      = rows[1]; // LANGUAGE_CODE row
    const nameRow      = rows[2]; // LANGUAGE_EN row
    const directionRow = rows[3]; // LANGUAGE_DIRECTION row

    // Skip column 0 which is the STRING ID column
    this.languages = [];
    for (let col = 1; col < headerRow.length; col++) {
      const key       = nameRow[col]?.trim()      || headerRow[col]?.trim() || `lang_${col}`;
      const code      = codeRow[col]?.trim()      || '';
      const direction = directionRow[col]?.trim() || 'ltr';
      this.languages.push({ key, name: key, direction, code, columnIndex: col });
    }

    // Build string table from remaining rows
    this._strings = {};
    for (let r = 4; r < rows.length; r++) {
      const row       = rows[r];
      const stringId  = row[0]?.trim();
      if (!stringId) continue;
      const entry = {};
      for (const lang of this.languages) {
        entry[lang.key] = row[lang.columnIndex]?.trim() ?? '';
      }
      this._strings[stringId] = entry;
    }

    // Restore saved selection
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && this.languages.some(l => l.key === saved)) {
      this.selectedLanguage = saved;
    }
  }

  /**
   * Sets the active language and persists it.
   * @param {string} key - LANGUAGE_EN value, e.g. "English"
   */
  setLanguage(key) {
    const valid = this.languages.some(l => l.key === key);
    if (!valid) {
      console.warn(`[TranslationManager] Unknown language key: "${key}"`);
      return;
    }
    this.selectedLanguage = key;
    localStorage.setItem(STORAGE_KEY, key);
  }

  /**
   * Returns true when the user has chosen a language this session (or a
   * previously saved choice was restored from localStorage).
   */
  hasSelection() {
    return this.selectedLanguage !== null;
  }

  /**
   * Returns the localized string for the given STRING ID.
   * Falls back to English, then the raw string ID if not found.
   * @param {string} stringId
   * @returns {string}
   */
  getText(stringId) {
    const entry = this._strings[stringId];
    if (!entry) return stringId;
    const lang = this.selectedLanguage || 'English';
    return entry[lang] || entry['English'] || stringId;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  _setFallback() {
    this.languages = [{ key: 'English', name: 'English', direction: 'ltr', code: 'enUS', columnIndex: 1 }];
    this.selectedLanguage = 'English';
  }
}
