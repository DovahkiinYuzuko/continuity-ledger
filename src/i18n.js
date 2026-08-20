let currentLocale = 'ja';
let dictionary = {};

/**
 * ブラウザ言語またはURLパラメータからロケールを検出して初期化
 */
export async function initI18n() {
  const params = new URLSearchParams(window.location.search);
  const paramLang = params.get('lang');
  
  const browserLang = (navigator.languages && navigator.languages[0]) || navigator.language || 'ja';
  let targetLocale = 'ja';

  if (paramLang && (paramLang === 'ja' || paramLang === 'en')) {
    targetLocale = paramLang;
  } else if (browserLang.startsWith('en')) {
    targetLocale = 'en';
  } else {
    targetLocale = 'ja';
  }

  currentLocale = targetLocale;

  try {
    const res = await fetch(`./locales/${currentLocale}.json`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    dictionary = await res.json();
  } catch (err) {
    console.warn(`[i18n] Failed to load ./locales/${currentLocale}.json, falling back to ja:`, err);
    try {
      const fallbackRes = await fetch('./locales/ja.json');
      dictionary = await fallbackRes.json();
      currentLocale = 'ja';
    } catch (fallbackErr) {
      console.error('[i18n] Failed to load fallback locale:', fallbackErr);
      dictionary = {};
    }
  }

  document.documentElement.lang = currentLocale;
  applyI18n(document);
}

/**
 * 現在のロケール文字列（'ja' | 'en'）を取得
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

  if (currentLocale === 'ja') {
    return t('date_format.jp', { year, month, day });
  } else {
    return t('date_format.simple', { year, month, day });
  }
}
