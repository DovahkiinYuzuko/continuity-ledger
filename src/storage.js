import { toScaled } from './math.js';

export const STORAGE_KEY = 'savings-ledger-scenarios-v2';
export const OLD_STORAGE_KEY = 'savings-ledger-scenarios';
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
 * localStorageからシナリオ一覧を取得（旧フォーマットからの自動移行対応）
 * @returns {Array}
 */
export function storageGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);

    // 旧バージョン（v1, Number方式）からの引き継ぎ
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const migrated = migrateFromV1(JSON.parse(old));
      storageSet(migrated);
      return migrated;
    }
    return [];
  } catch (e) {
    console.error('[storage] 読み込みに失敗しました', e);
    return [];
  }
}

/**
 * v1フォーマットのデータをv2（BigIntスケール文字列）へ変換
 * @param {Array} oldScenarios
 * @returns {Array}
 */
export function migrateFromV1(oldScenarios) {
  return (oldScenarios || []).map(s => ({
    id: s.id || genId(),
    name: s.name || '',
    start: s.start,
    amountScaled: toScaled(String(s.amount || 0))?.toString() || '0',
    targetAmountScaled: s.targetAmount ? toScaled(String(s.targetAmount))?.toString() : null,
    currency: s.currency || '円',
    intervalType: s.intervalType || 'days',
    interval: s.interval || 1,
    monthDay: s.monthDay || 1,
    color: s.color || DEFAULT_COLORS[0],
    interrupts: (s.interrupts || []).map(iv => ({
      id: iv.id || genId(),
      date: iv.date,
      amountScaled: toScaled(String(iv.amount || 0))?.toString() || '0'
    }))
  }));
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
