import { fromScaled, totalAt, todayStr, intervalLabel, calculateTargetDate } from './math.js';
import { t, formatDateLocale } from './i18n.js';
import { genId, storageSet } from './storage.js';

/**
 * CSVエクスポート（BOM付きUTF-8）
 * @param {Array} scenarios
 */
export function exportCsv(scenarios) {
  if (!scenarios || scenarios.length === 0) {
    alert(t('export.alert_empty'));
    return;
  }
  const today = todayStr();
  const header = t('export.csv_header');
  const rows = [Array.isArray(header) ? header : ['シナリオ名','開始日','1回あたりの額','通貨','間隔','今日時点の累計回数','割り込み合計','今日時点の累計額','目標金額','目標到達日']];

  scenarios.forEach(s => {
    const { count, total, interruptTotal } = totalAt(s, today);
    let targetStr = '';
    let targetDateStr = '';
    if (s.targetAmountScaled) {
      targetStr = fromScaled(s.targetAmountScaled);
      const res = calculateTargetDate(s, s.targetAmountScaled);
      if (res) {
        targetDateStr = res.reached ? t('ledger.target_reached', { target: targetStr, currency: s.currency }) : res.targetDateStr;
      }
    }

    rows.push([
      s.name || t('ledger.untitled'),
      s.start,
      fromScaled(s.amountScaled),
      s.currency,
      intervalLabel(s),
      count,
      fromScaled(interruptTotal),
      fromScaled(total),
      targetStr,
      targetDateStr
    ]);
  });

  rows.push([]);
  rows.push([t('export.csv_interrupt_section')]);
  const ivHeader = t('export.csv_interrupt_header');
  rows.push(Array.isArray(ivHeader) ? ivHeader : ['シナリオ名','日付','割り込み額']);
  
  scenarios.forEach(s => {
    (s.interrupts || []).forEach(iv => {
      rows.push([s.name || t('ledger.untitled'), iv.date, fromScaled(iv.amountScaled)]);
    });
  });

  const csv = rows.map(r => r.map(cell => {
    const str = String(cell ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(',')).join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = t('export.csv_filename', { date: today });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * JSONバックアップエクスポート
 * @param {Array} scenarios
 */
export function exportJson(scenarios) {
  if (!scenarios || scenarios.length === 0) {
    alert(t('export.alert_empty'));
    return;
  }
  const payload = { version: 2, exportedAt: todayStr(), scenarios };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = t('export.json_filename', { date: todayStr() });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * JSONバックアップインポート
 * @param {File} file
 * @param {Array} currentScenarios
 * @param {Function} onComplete (updatedScenarios) => void
 */
export async function importJson(file, currentScenarios, onComplete) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = Array.isArray(payload) ? payload : payload.scenarios;
    if (!Array.isArray(incoming)) throw new Error('Invalid format');

    // 必須フィールドの簡易バリデーション
    const valid = incoming.filter(s => s && s.start && s.amountScaled !== undefined);
    if (valid.length === 0) {
      alert(t('import.alert_no_valid'));
      return;
    }

    const mode = confirm(t('import.confirm_mode', { count: valid.length })) ? 'merge' : 'replace';

    let resultScenarios = [];
    if (mode === 'replace') {
      if (!confirm(t('import.confirm_replace'))) return;
      resultScenarios = valid.map(s => ({ ...s, id: s.id || genId() }));
    } else {
      const existingIds = new Set(currentScenarios.map(s => s.id));
      const merged = valid.map(s => existingIds.has(s.id) ? { ...s, id: genId() } : s);
      resultScenarios = currentScenarios.concat(merged);
    }

    await storageSet(resultScenarios);
    onComplete(resultScenarios);
    alert(t('import.alert_success'));
  } catch (err) {
    console.error('[import]', err);
    alert(t('import.alert_failed'));
  }
}

/**
 * URLによるシナリオ単体共有
 * @param {object} s
 */
export function shareScenarioUrl(s) {
  if (!s) return;
  const payload = {
    name: s.name,
    start: s.start,
    amountScaled: s.amountScaled,
    targetAmountScaled: s.targetAmountScaled || null,
    currency: s.currency,
    intervalType: s.intervalType,
    interval: s.interval,
    monthDay: s.monthDay,
    color: s.color
  };
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  const url = `${window.location.origin}${window.location.pathname}?share=${encoded}`;

  if (navigator.share) {
    navigator.share({ title: t('app.title'), url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      alert(t('share.alert_copy'));
    }).catch(() => {
      prompt(t('share.prompt_copy'), url);
    });
  } else {
    prompt(t('share.prompt_copy'), url);
  }
}

/**
 * 起動時にURLクエリの ?share= をチェックして取り込む
 * @param {Function} onImport (newScenario) => Promise<void>
 */
export async function checkShareParam(onImport) {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('share');
  if (!encoded) return;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
    const payload = JSON.parse(json);
    if (!payload.start || payload.amountScaled === undefined) return;

    const label = t('share.label_format', {
      name: payload.name || t('ledger.untitled'),
      start: formatDateLocale(payload.start)
    });

    if (confirm(t('share.confirm_import', { label }))) {
      const newScenario = {
        id: genId(),
        name: payload.name || '',
        start: payload.start,
        amountScaled: payload.amountScaled,
        targetAmountScaled: payload.targetAmountScaled || null,
        currency: payload.currency || t('form.default_currency'),
        intervalType: payload.intervalType || 'days',
        interval: payload.interval || 1,
        monthDay: payload.monthDay || 1,
        color: payload.color || '#a4402f',
        interrupts: []
      };
      await onImport(newScenario);
    }
    window.history.replaceState(null, '', window.location.pathname);
  } catch (err) {
    console.error('[share] Failed to parse share param:', err);
  }
}
