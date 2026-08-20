export const STORAGE_KEY = 'savings-ledger-scenarios-v2';
export const CUSTOM_COLORS_KEY = 'savings-ledger-custom-colors';
export const MAX_CUSTOM_COLORS = 24;

export const DEFAULT_COLORS = [
  '#a4402f',
  '#4a5d43',
  '#a37f3a',
  '#3d5a80',
  '#7d5ba6',
  '#b5651d'
];

/**
 * ランダムIDを生成
 * @returns {string}
 */
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * localStorageからシナリオ一覧を取得
 * @returns {Array}
 */
export function storageGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[storage] 読み込みに失敗しました', e);
    return [];
  }
}

/**
 * localStorageへシナリオ一覧を保存
 * @param {Array} data
 */
export function storageSet(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[storage] 保存に失敗しました', e);
  }
}

/**
 * 保存されているカスタムカラー配列を取得
 * @returns {string[]}
 */
export function getCustomColors() {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * カスタムカラー配列を保存
 * @param {string[]} colors
 */
export function saveCustomColors(colors) {
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  } catch (e) {
    console.error('[storage] カスタムカラーの保存に失敗しました', e);
  }
}
