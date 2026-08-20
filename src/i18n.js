const FALLBACK_LOCALE = 'en';

let currentLocale = FALLBACK_LOCALE;
let dictionary = {};

/**
 * オブジェクトのディープマージ（欠損キーをフォールバック辞書の値で補完する）
 * @param {object} base フォールバック辞書
 * @param {object} override ターゲット言語の辞書
 * @returns {object}
 */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      override[key] &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * ブラウザ言語またはURLパラメータから言語コード（例: 'ja', 'en', 'ko', 'fr' など）を抽出
 * @returns {string}
 */
function detectTargetLocale() {
  const params = new URLSearchParams(window.location.search);
  const paramLang = params.get('lang');
  if (paramLang) {
    return paramLang.trim().toLowerCase().split('-')[0];
  }

  const rawLang = (navigator.languages && navigator.languages[0]) || navigator.language || FALLBACK_LOCALE;
  return rawLang.trim().toLowerCase().split('-')[0];
}

/**
 * 指定した言語のJSONファイルを非同期取得
 * @param {string} locale
 * @returns {Promise<object|null>}
 */
async function fetchLocaleJson(locale) {
  try {
    const res = await fetch(`./locales/${locale}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * i18nの初期化
 * 1. フォールバック言語（en）をロード
 * 2. ユーザーの言語（./locales/${targetLocale}.json）を動的フェッチ
 * 3. 存在すればマージして欠損キーを補完、無ければフォールバックのまま動作
 */
export async function initI18n() {
  const targetLocale = detectTargetLocale();

  // 1. フォールバック辞書（en.json）をベースとしてロード
  const fallbackDict = (await fetchLocaleJson(FALLBACK_LOCALE)) || {};

  // 2. ターゲット言語の辞書を動的フェッチ
  if (targetLocale === FALLBACK_LOCALE) {
    dictionary = fallbackDict;
    currentLocale = FALLBACK_LOCALE;
  } else {
    const targetDict = await fetchLocaleJson(targetLocale);
    if (targetDict) {
      // ターゲット言語が存在する場合は、欠損キーをフォールバックで補完して適用
      dictionary = deepMerge(fallbackDict, targetDict);
      currentLocale = targetLocale;
    } else {
      // 存在しない言語ファイルの場合はフォールバックをそのまま使用
      console.warn(`[i18n] Locale "${targetLocale}.json" not found. Falling back to "${FALLBACK_LOCALE}".`);
      dictionary = fallbackDict;
      currentLocale = FALLBACK_LOCALE;
    }
  }

  document.documentElement.lang = currentLocale;
  applyI18n(document);
}

/**
 * 現在のロケール文字列（'ja' | 'en' | 'ko' ...）を取得
 * @returns {string}
 */
export function getLocale() {
  return currentLocale;
}

/**
 * ドット区切りのキーから翻訳文字列を取得し、パラメータを埋め込む
 * @param {string} keyPath 例: 'app.title', 'form.alert_color_limit'
 * @param {Record<string, string|number>} [params] 例: { max: 24, count: 3 }
 * @returns {string}
 */
export function t(keyPath, params = {}) {
  const parts = keyPath.split('.');
  let current = dictionary;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return keyPath; // 未定義時はキー名をそのまま返す
    }
  }

  if (typeof current !== 'string') {
    return current; // 配列などの場合はそのまま
  }

  return current.replace(/\{(\w+)\}/g, (_, paramName) => {
    return paramName in params ? String(params[paramName]) : `{${paramName}}`;
  });
}

/**
 * DOM要素内の data-i18n* 属性を走査して翻訳テキストを反映する
 * @param {HTMLElement|Document} [root=document]
 */
export function applyI18n(root = document) {
  // テキストコンテンツ
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  // HTMLコンテンツ（<br>などを含む場合）
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });

  // placeholder属性
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });

  // title / tooltip 属性
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });

  // value属性（inputやbuttonのvalue）
  root.querySelectorAll('[data-i18n-value]').forEach(el => {
    const key = el.dataset.i18nValue;
    if (key) el.value = t(key);
  });
}

/**
 * 言語に応じた日付フォーマット
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string}
 */
export function formatDateLocale(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();

  // 辞書に date_format.jp が定義されているロケール（ja, ko等）はそちらを優先、それ以外は simple
  const formatTemplate = t('date_format.jp');
  if (formatTemplate && formatTemplate !== 'date_format.jp' && (currentLocale === 'ja' || currentLocale === 'ko' || currentLocale === 'zh')) {
    return t('date_format.jp', { year, month, day });
  } else {
    return t('date_format.simple', { year, month, day });
  }
}
