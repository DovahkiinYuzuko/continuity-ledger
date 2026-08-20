import { t } from './i18n.js';

export const DECIMALS = 6; // 内部固定小数点の桁数（BigIntで扱う）
export const SCALE = 10n ** BigInt(DECIMALS);

/**
 * "1234.5" のような文字列 → BigInt（スケール済み）
 * @param {string|number} str
 * @returns {bigint|null}
 */
export function toScaled(str) {
  str = String(str).trim();
  if (str === '' || isNaN(Number(str))) return null;
  const neg = str.startsWith('-');
  if (neg) str = str.slice(1);
  let [intPart, decPart = ''] = str.split('.');
  intPart = intPart.replace(/\D/g, '') || '0';
  decPart = decPart.replace(/\D/g, '');
  decPart = (decPart + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  let result = BigInt(intPart) * SCALE + BigInt(decPart || '0');
  if (neg) result = -result;
  return result;
}

/**
 * スケール済みBigInt → 表示用文字列（桁区切り＋小数点、末尾ゼロ削除）
 * @param {bigint|number|string} scaled
 * @returns {string}
 */
export function fromScaled(scaled) {
  if (typeof scaled !== 'bigint') scaled = BigInt(scaled || 0);
  const neg = scaled < 0n;
  if (neg) scaled = -scaled;
  const intPart = scaled / SCALE;
  const decPart = scaled % SCALE;
  let decStr = decPart.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const withCommas = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = withCommas;
  if (decStr) out += '.' + decStr;
  return (neg ? '-' : '') + out;
}

/**
 * 今日の日付文字列（YYYY-MM-DD）を取得
 * @returns {string}
 */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 2つの日付間の日数を取得
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr 'YYYY-MM-DD'
 * @returns {number}
 */
export function daysBetween(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.floor((end - start) / 86400000);
}

/**
 * 指定年月の日数を取得（month0: 0-indexed）
 * @param {number} year
 * @param {number} month0
 * @returns {number}
 */
export function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * そのシナリオが指定日に「入金日」かどうか
 * @param {object} scenario
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function isDepositDay(scenario, dateStr) {
  if (dateStr < scenario.start) return false;
  if (scenario.end && dateStr > scenario.end) return false;

  if (scenario.intervalType === 'days') {
    const diff = daysBetween(scenario.start, dateStr);
    return diff % scenario.interval === 0;
  }
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const lastDay = daysInMonth(y, m);
  if (scenario.intervalType === 'monthlyLast') {
    return day === lastDay;
  }
  if (scenario.intervalType === 'monthlyDate') {
    const targetDay = Math.min(scenario.monthDay, lastDay);
    return day === targetDay;
  }
  return false;
}

/**
 * 開始日から指定日までの入金回数を数える
 * @param {object} scenario
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {number}
 */
export function countDepositsUpTo(scenario, dateStr) {
  if (dateStr < scenario.start) return 0;
  const effectiveEnd = (scenario.end && scenario.end < dateStr) ? scenario.end : dateStr;
  if (effectiveEnd < scenario.start) return 0;

  if (scenario.intervalType === 'days') {
    const diff = daysBetween(scenario.start, effectiveEnd);
    return Math.floor(diff / scenario.interval) + 1;
  }
  const start = new Date(scenario.start + 'T00:00:00');
  const end = new Date(effectiveEnd + 'T00:00:00');
  let count = 0;
  let y = start.getFullYear(), m = start.getMonth();
  const endY = end.getFullYear(), endM = end.getMonth(), endDay = end.getDate();
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = daysInMonth(y, m);
    const targetDay = scenario.intervalType === 'monthlyLast' ? lastDay : Math.min(scenario.monthDay, lastDay);
    const targetDateNum = y * 10000 + m * 100 + targetDay;
    const startDateNum = start.getFullYear() * 10000 + start.getMonth() * 100 + start.getDate();
    const cutoffDateNum = (y === endY && m === endM) ? (endY * 10000 + endM * 100 + endDay) : Infinity;
    if (targetDateNum >= startDateNum && targetDateNum <= cutoffDateNum) {
      count++;
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return count;
}

/**
 * 開始日から指定日までの累計（回数・定期分・割り込み分・合計）をBigIntスケール値で返す
 * @param {object} scenario
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {{ count: number, total: bigint, interruptTotal: bigint }}
 */
export function totalAt(scenario, dateStr) {
  const count = countDepositsUpTo(scenario, dateStr);
  const amountScaled = BigInt(scenario.amountScaled);
  const regularTotal = amountScaled * BigInt(count);
  const effectiveEnd = (scenario.end && scenario.end < dateStr) ? scenario.end : dateStr;
  const interrupts = (scenario.interrupts || []).filter(iv => iv.date <= effectiveEnd);
  const interruptTotal = interrupts.reduce((sum, iv) => sum + BigInt(iv.amountScaled), 0n);
  return { count, total: regularTotal + interruptTotal, interruptTotal };
}

/**
 * 指定日の割り込み記録一覧を取得
 * @param {object} scenario
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Array}
 */
export function interruptsOn(scenario, dateStr) {
  return (scenario.interrupts || []).filter(iv => iv.date === dateStr);
}

/**
 * シナリオの間隔ラベル（i18n対応）
 * @param {object} s
 * @returns {string}
 */
export function intervalLabel(s) {
  if (s.intervalType === 'days') return `${s.interval} ${t('form.unit_days_every')}`;
  if (s.intervalType === 'monthlyLast') return t('form.interval_monthly_last');
  if (s.intervalType === 'monthlyDate') {
    return `${t('form.unit_monthly_prefix')}${s.monthDay}${t('form.unit_monthly_suffix')}`;
  }
  return '';
}

/**
 * 目標金額に達する予定日を試算・逆算する
 * @param {object} scenario
 * @param {bigint|string} targetAmountScaled
 * @returns {{ reached: boolean, targetDateStr: string, remainingDays: number } | null}
 */
export function calculateTargetDate(scenario, targetAmountScaled) {
  if (!targetAmountScaled) return null;
  const targetScaled = typeof targetAmountScaled === 'bigint' ? targetAmountScaled : BigInt(targetAmountScaled);
  if (targetScaled <= 0n) return null;

  const today = todayStr();
  const currentTotal = totalAt(scenario, today).total;
  if (currentTotal >= targetScaled) {
    return { reached: true, targetDateStr: today, remainingDays: 0 };
  }

  const perDepositScaled = BigInt(scenario.amountScaled);
  if (perDepositScaled <= 0n) return null;

  // 過去〜未来の既存割り込みを含めた累計でシミュレーション
  const allInterrupts = scenario.interrupts || [];
  
  if (scenario.intervalType === 'days') {
    let currentDate = new Date(today + 'T00:00:00');
    const maxDate = new Date(currentDate.getTime() + 100 * 365 * 86400000);
    let accumulated = currentTotal;
    
    currentDate.setDate(currentDate.getDate() + 1);
    while (currentDate <= maxDate) {
      const dStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      if (scenario.end && dStr > scenario.end) break;

      if (isDepositDay(scenario, dStr)) {
        accumulated += perDepositScaled;
      }
      const ivs = allInterrupts.filter(iv => iv.date === dStr);
      for (const iv of ivs) {
        accumulated += BigInt(iv.amountScaled);
      }

      if (accumulated >= targetScaled) {
        return {
          reached: false,
          targetDateStr: dStr,
          remainingDays: daysBetween(today, dStr)
        };
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
  } else {
    const [tY, tM] = today.split('-').map(Number);
    let y = tY, m = tM - 1;
    let accumulated = currentTotal;

    for (let monthOffset = 0; monthOffset < 1200; monthOffset++) {
      const lastDay = daysInMonth(y, m);
      const targetDay = scenario.intervalType === 'monthlyLast' ? lastDay : Math.min(scenario.monthDay, lastDay);
      const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

      if (scenario.end && dStr > scenario.end) break;

      if (dStr > today) {
        accumulated += perDepositScaled;
        const ivs = allInterrupts.filter(iv => iv.date === dStr);
        for (const iv of ivs) {
          accumulated += BigInt(iv.amountScaled);
        }
        if (accumulated >= targetScaled) {
          return {
            reached: false,
            targetDateStr: dStr,
            remainingDays: daysBetween(today, dStr)
          };
        }
      }

      m++;
      if (m > 11) { m = 0; y++; }
    }
  }

  return null;
}

/**
 * 指定期日までに目標金額を達成するための1回あたり必要積立額を逆算する
 * @param {object} scenario
 * @param {bigint|string} targetAmountScaled
 * @param {string} targetDeadlineStr 'YYYY-MM-DD'
 * @returns {{ alreadyReached: boolean, requiredPerDepositScaled: bigint, remainingDeposits: number, projectedTotalScaled: bigint, noDeposits: boolean }}
 */
export function calculateRequiredAmountPerDeposit(scenario, targetAmountScaled, targetDeadlineStr) {
  const targetScaled = typeof targetAmountScaled === 'bigint' ? targetAmountScaled : BigInt(targetAmountScaled);
  const today = todayStr();

  // 現在時点の累計
  const currentTotal = totalAt(scenario, today).total;
  if (currentTotal >= targetScaled) {
    return { alreadyReached: true, requiredPerDepositScaled: 0n, remainingDeposits: 0, projectedTotalScaled: currentTotal, noDeposits: false };
  }

  // 今日から期日までの定期入金予定回数を数える
  let remainingDeposits = 0;
  let futureInterruptTotal = 0n;
  const allInterrupts = scenario.interrupts || [];

  const startD = new Date(today + 'T00:00:00');
  startD.setDate(startD.getDate() + 1); // 明日以降
  const endD = new Date(targetDeadlineStr + 'T00:00:00');

  let curr = new Date(startD);
  while (curr <= endD) {
    const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
    if (scenario.end && dStr > scenario.end) break;

    if (isDepositDay(scenario, dStr)) {
      remainingDeposits++;
    }
    const ivs = allInterrupts.filter(iv => iv.date === dStr);
    for (const iv of ivs) {
      futureInterruptTotal += BigInt(iv.amountScaled);
    }
    curr.setDate(curr.getDate() + 1);
  }

  // 現行ペースでの期日到達見込額
  const currentPerDeposit = BigInt(scenario.amountScaled);
  const projectedTotalScaled = currentTotal + (currentPerDeposit * BigInt(remainingDeposits)) + futureInterruptTotal;

  if (projectedTotalScaled >= targetScaled) {
    return { alreadyReached: true, requiredPerDepositScaled: currentPerDeposit, remainingDeposits, projectedTotalScaled, noDeposits: false };
  }

  if (remainingDeposits === 0) {
    return { alreadyReached: false, requiredPerDepositScaled: 0n, remainingDeposits: 0, projectedTotalScaled, noDeposits: true };
  }

  // 必要積立額 = (目標金額 - 今日までの累計 - 未来の割り込み分) / 残り入金回数
  const remainingNeeded = targetScaled - currentTotal - futureInterruptTotal;
  const neededPerDeposit = (remainingNeeded > 0n) ? (remainingNeeded / BigInt(remainingDeposits)) : 0n;

  return {
    alreadyReached: false,
    requiredPerDepositScaled: neededPerDeposit,
    remainingDeposits,
    projectedTotalScaled,
    noDeposits: false
  };
}
