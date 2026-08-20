const STORAGE_KEY = 'savings-ledger-scenarios-v2';
const OLD_STORAGE_KEY = 'savings-ledger-scenarios';
const COLORS = ['#a4402f', '#4a5d43', '#a37f3a', '#3d5a80', '#7d5ba6', '#b5651d'];
const DECIMALS = 6; // 内部固定小数点の桁数（BigIntで扱う）
const SCALE = 10n ** BigInt(DECIMALS);

let scenarios = [];
let selectedColor = COLORS[0];
let viewYear, viewMonth; // viewMonth: 0-indexed
let selectedDateStr = null;
let editingId = null; // 編集中のシナリオID（null=新規）

/* ============ 巨大数対応：固定小数点BigIntユーティリティ ============
   金額は「表示用の文字列」として入力を受け取り、内部では
   BigInt(整数部 * 10^DECIMALS + 小数部) の形で保持する。
   浮動小数点誤差なしで加算・乗算ができる。 */

// "1234.5" のような文字列 → BigInt（スケール済み）
function toScaled(str) {
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

// スケール済みBigInt → 表示用文字列（桁区切り＋小数点、末尾ゼロ削除）
function fromScaled(scaled) {
  if (typeof scaled !== 'bigint') scaled = BigInt(scaled || 0);
  const neg = scaled < 0n;
  if (neg) scaled = -scaled;
  const intPart = scaled / SCALE;
  const decPart = scaled % SCALE;
  let decStr = decPart.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const intStr = intPart.toLocaleString('en-US'); // 桁区切りだけ流用、後で置換
  const withCommas = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = withCommas;
  if (decStr) out += '.' + decStr;
  return (neg ? '-' : '') + out;
}

// スケール済みBigInt同士の乗算（回数などの小さい整数と掛ける）
function mulScaledByInt(scaled, n) {
  return scaled * BigInt(n);
}

/* ============ ストレージ（localStorage） ============ */

async function storageGet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // 旧バージョン（v1, Number方式）からの引き継ぎを試みる
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const oldData = JSON.parse(old);
      return migrateFromV1(oldData);
    }
    return [];
  } catch (e) {
    console.error('読み込みに失敗しました', e);
    return [];
  }
}

function migrateFromV1(oldScenarios) {
  return (oldScenarios || []).map(s => ({
    id: s.id,
    name: s.name,
    start: s.start,
    amountScaled: toScaled(String(s.amount)).toString(),
    currency: s.currency,
    intervalType: 'days',
    interval: s.interval,
    monthDay: 1,
    color: s.color,
    interrupts: (s.interrupts || []).map(iv => ({
      id: iv.id, date: iv.date, amountScaled: toScaled(String(iv.amount)).toString()
    }))
  }));
}

async function storageSet(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('保存に失敗しました', e);
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysBetween(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.floor((end - start) / 86400000);
}

function daysInMonth(year, month0) { // month0: 0-indexed
  return new Date(year, month0 + 1, 0).getDate();
}

/* ============ 間隔ロジック：3方式対応 ============
   - days: 開始日からn日ごと
   - monthlyDate: 毎月d日（d日が月に無ければ月末扱い）
   - monthlyLast: 毎月末日
*/

// そのシナリオが指定日に「入金日」かどうか
function isDepositDay(scenario, dateStr) {
  if (dateStr < scenario.start) return false;
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

// 開始日から指定日までの入金回数を数える
function countDepositsUpTo(scenario, dateStr) {
  if (dateStr < scenario.start) return 0;
  if (scenario.intervalType === 'days') {
    const diff = daysBetween(scenario.start, dateStr);
    return Math.floor(diff / scenario.interval) + 1;
  }
  // monthlyDate / monthlyLast: 開始月から指定月までの月数をベースに数える
  const start = new Date(scenario.start + 'T00:00:00');
  const end = new Date(dateStr + 'T00:00:00');
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

// 開始日から指定日までの累計（回数・定期分・割り込み分・合計）をBigIntスケール値で返す
function totalAt(scenario, dateStr) {
  const count = countDepositsUpTo(scenario, dateStr);
  const amountScaled = BigInt(scenario.amountScaled);
  const regularTotal = mulScaledByInt(amountScaled, count);
  const interrupts = (scenario.interrupts || []).filter(iv => iv.date <= dateStr);
  const interruptTotal = interrupts.reduce((sum, iv) => sum + BigInt(iv.amountScaled), 0n);
  return { count, total: regularTotal + interruptTotal, interruptTotal };
}

function interruptsOn(scenario, dateStr) {
  return (scenario.interrupts || []).filter(iv => iv.date === dateStr);
}

function intervalLabel(s) {
  if (s.intervalType === 'days') return `${s.interval}日ごと`;
  if (s.intervalType === 'monthlyLast') return '毎月末日';
  if (s.intervalType === 'monthlyDate') return `毎月${s.monthDay}日`;
  return '';
}

function formatDateJP(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============ 描画: 全シナリオ合算 ============ */
function renderGrandTotal() {
  const el = document.getElementById('grandTotal');
  if (scenarios.length < 2) {
    el.classList.remove('show');
    return;
  }
  const today = todayStr();
  // 通貨単位ごとに合算する（違う通貨を無理に足さない）
  const byCurrency = {};
  scenarios.forEach(s => {
    const { total } = totalAt(s, today);
    byCurrency[s.currency] = (byCurrency[s.currency] || 0n) + total;
  });
  const currencies = Object.keys(byCurrency);
  el.classList.add('show');
  if (currencies.length === 1) {
    const cur = currencies[0];
    el.innerHTML = `<div class="label">全シナリオ合計</div><div class="num">${fromScaled(byCurrency[cur])}<span class="cur">${escapeHtml(cur)}</span></div>`;
  } else {
    el.innerHTML = `<div class="label">全シナリオ合計</div>` + currencies.map(cur =>
      `<div class="num" style="font-size:18px">${fromScaled(byCurrency[cur])}<span class="cur">${escapeHtml(cur)}</span></div>`
    ).join('');
  }
}

/* ============ 描画: シナリオ一覧 ============ */
function renderLedgerList() {
  const list = document.getElementById('ledgerList');
  if (scenarios.length === 0) {
    list.innerHTML = `<div class="empty-note">まだ何も記帳されてません。<br>下のボタンから「いつから」「いくら」「どのくらいの間隔で」を記帳すると、<br>今日時点でいくらになってたかが積み上がって表示されます。</div>`;
    return;
  }
  const today = todayStr();
  list.innerHTML = scenarios.map(s => {
    const { count, total } = totalAt(s, today);
    const allInterrupts = (s.interrupts || []).slice().sort((a,b) => a.date < b.date ? -1 : 1);
    const futureInterrupts = allInterrupts.filter(iv => iv.date > today);
    const futureTotal = futureInterrupts.reduce((sum, iv) => sum + BigInt(iv.amountScaled), 0n);
    const pendingLabel = futureTotal > 0n ? `<span class="ledger-pending">（予定 +${fromScaled(futureTotal)}）</span>` : '';

    const interruptsBody = allInterrupts.length === 0
      ? `<div class="ledger-iv-empty">割り込みの記録はまだ無いよ</div>`
      : allInterrupts.map(iv => {
          const isFuture = iv.date > today;
          return `
            <div class="ledger-iv-entry ${isFuture ? 'future' : ''}">
              <span class="ledger-iv-date">${formatDateJP(iv.date)}</span>
              <span>
                <span class="ledger-iv-amt">+${fromScaled(iv.amountScaled)}${escapeHtml(s.currency)}</span>
                <button class="ledger-iv-del" data-sid="${s.id}" data-ivid="${iv.id}"><svg class="icon-sm"><use href="#icon-x"/></svg></button>
              </span>
            </div>
          `;
        }).join('');

    return `
      <details class="ledger-card" style="--tag-color:${s.color}">
        <summary>
          <div class="ledger-info">
            <div class="ledger-name">${escapeHtml(s.name || '無題')}</div>
            <div class="ledger-meta">${formatDateJP(s.start)}から・${intervalLabel(s)}に${fromScaled(s.amountScaled)}${escapeHtml(s.currency)}・${count}回分</div>
          </div>
          <div class="ledger-amount">
            <span class="num">${fromScaled(total)}</span><span class="cur">${escapeHtml(s.currency)}</span>
            ${pendingLabel}
          </div>
          <div class="ledger-actions">
            <button class="ledger-share" data-id="${s.id}" title="URLで共有"><svg class="icon-sm"><use href="#icon-share"/></svg></button>
            <button class="ledger-edit" data-id="${s.id}" title="編集"><svg class="icon-sm"><use href="#icon-pencil"/></svg></button>
            <button class="ledger-del" data-id="${s.id}" title="削除"><svg class="icon-sm"><use href="#icon-x"/></svg></button>
          </div>
        </summary>
        <div class="ledger-interrupts">${interruptsBody}</div>
      </details>
    `;
  }).join('');

  list.querySelectorAll('.ledger-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (!confirm('この記帳を消す？割り込み記録も一緒に消えるよ')) return;
      scenarios = scenarios.filter(s => s.id !== id);
      await storageSet(scenarios);
      renderAll();
    });
  });

  list.querySelectorAll('.ledger-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      openFormForEdit(id);
    });
  });

  list.querySelectorAll('.ledger-share').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      shareScenarioUrl(id);
    });
  });

  list.querySelectorAll('.ledger-iv-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = e.currentTarget.dataset.sid;
      const ivid = e.currentTarget.dataset.ivid;
      const s = scenarios.find(sc => sc.id === sid);
      if (s) {
        s.interrupts = (s.interrupts || []).filter(iv => iv.id !== ivid);
        await storageSet(scenarios);
        renderAll();
      }
    });
  });
}

/* ============ 描画: カレンダー ============ */
function renderCalendar() {
  const title = document.getElementById('calTitle');
  title.textContent = `${viewYear}年 ${viewMonth+1}月`;
  syncJumpSelects();

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  ['日','月','火','水','木','金','土'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstDay.getDay();
  const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < startWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }

  for (let day = 1; day <= lastDate; day++) {
    const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (dateStr === today) cell.classList.add('today');
    if (dateStr === selectedDateStr) cell.classList.add('selected');
    cell.dataset.date = dateStr;

    const marks = scenarios.filter(s => isDepositDay(s, dateStr));
    cell.innerHTML = `
      <div class="cal-daynum">${day}</div>
      <div class="cal-marks">${marks.map(m => `<span class="cal-mark" style="background:${m.color}"></span>`).join('')}</div>
    `;
    cell.addEventListener('click', () => {
      selectedDateStr = (selectedDateStr === dateStr) ? null : dateStr;
      renderCalendar();
      renderDayDetail();
    });
    grid.appendChild(cell);
  }
}

/* ============ 年月ジャンプ ============ */
function setupJumpSelects() {
  const yearSel = document.getElementById('jumpYear');
  const monthSel = document.getElementById('jumpMonth');
  const nowYear = new Date().getFullYear();
  const yearRange = [];
  for (let y = nowYear - 10; y <= nowYear + 10; y++) yearRange.push(y);
  yearSel.innerHTML = yearRange.map(y => `<option value="${y}">${y}年</option>`).join('');
  monthSel.innerHTML = Array.from({length:12}, (_,i) => `<option value="${i}">${i+1}月</option>`).join('');

  yearSel.addEventListener('change', () => {
    viewYear = parseInt(yearSel.value);
    if (yearViewOpen) renderYearGrid(); else renderCalendar();
  });
  monthSel.addEventListener('change', () => {
    viewMonth = parseInt(monthSel.value);
    renderCalendar();
  });
}

function syncJumpSelects() {
  const yearSel = document.getElementById('jumpYear');
  const monthSel = document.getElementById('jumpMonth');
  if (yearSel.value !== String(viewYear)) yearSel.value = String(viewYear);
  if (monthSel.value !== String(viewMonth)) monthSel.value = String(viewMonth);
  monthSel.style.display = yearViewOpen ? 'none' : '';
}

document.getElementById('todayBtn').addEventListener('click', () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDateStr = null;
  if (yearViewOpen) {
    renderYearGrid();
  } else {
    renderCalendar();
  }
  renderDayDetail();
});

/* ============ 年間プレビュー ============ */
let yearViewOpen = false;

document.getElementById('yearViewBtn').addEventListener('click', () => {
  yearViewOpen = !yearViewOpen;
  document.getElementById('yearViewBtn').classList.toggle('active', yearViewOpen);
  document.getElementById('calGrid').style.display = yearViewOpen ? 'none' : 'grid';
  document.getElementById('yearGrid').style.display = yearViewOpen ? 'grid' : 'none';
  syncJumpSelects();
  if (yearViewOpen) {
    renderYearGrid();
  } else {
    renderCalendar();
  }
});

function renderYearGrid() {
  document.getElementById('calTitle').textContent = `${viewYear}年`;
  syncJumpSelects();

  const grid = document.getElementById('yearGrid');
  const today = todayStr();
  grid.innerHTML = '';

  for (let m = 0; m < 12; m++) {
    const lastDate = new Date(viewYear, m + 1, 0).getDate();
    const firstWeekday = new Date(viewYear, m, 1).getDay();
    const isCurrentMonth = (viewYear === new Date().getFullYear() && m === new Date().getMonth());

    let miniCells = '';
    for (let i = 0; i < firstWeekday; i++) {
      miniCells += `<div class="year-grid-mini-cell blank"></div>`;
    }
    for (let day = 1; day <= lastDate; day++) {
      const dateStr = `${viewYear}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const hasDeposit = scenarios.some(s => isDepositDay(s, dateStr));
      miniCells += `<div class="year-grid-mini-cell ${hasDeposit ? 'has-deposit' : ''}"></div>`;
    }

    const monthDiv = document.createElement('div');
    monthDiv.className = `year-grid-month ${isCurrentMonth ? 'current' : ''}`;
    monthDiv.innerHTML = `
      <div class="year-grid-month-label">${m+1}月</div>
      <div class="year-grid-mini">${miniCells}</div>
    `;
    monthDiv.addEventListener('click', () => {
      viewMonth = m;
      yearViewOpen = false;
      document.getElementById('yearViewBtn').classList.remove('active');
      document.getElementById('calGrid').style.display = 'grid';
      document.getElementById('yearGrid').style.display = 'none';
      renderCalendar();
    });
    grid.appendChild(monthDiv);
  }
}

function renderDayDetail() {
  const panel = document.getElementById('dayDetail');
  const interruptRow = document.getElementById('interruptRow');
  if (!selectedDateStr || scenarios.length === 0) {
    panel.classList.remove('open');
    return;
  }
  panel.classList.add('open');
  document.getElementById('dayDetailDate').textContent = formatDateJP(selectedDateStr);
  const body = document.getElementById('dayDetailBody');

  const relevant = scenarios.filter(s => selectedDateStr >= s.start);
  if (relevant.length === 0) {
    body.innerHTML = `<div class="day-detail-empty">この日はまだどのシナリオも始まってません</div>`;
  } else {
    body.innerHTML = relevant.map(s => {
      const { count, total } = totalAt(s, selectedDateStr);
      const isFuture = selectedDateStr > todayStr();
      const todaysInterrupts = interruptsOn(s, selectedDateStr);
      const interruptLines = todaysInterrupts.map(iv => `
        <div class="interrupt-entry">
          <span>└ ${escapeHtml(s.name || '無題')}への割り込み</span>
          <span><span class="amt">+${fromScaled(iv.amountScaled)}${escapeHtml(s.currency)}</span>
          <button class="interrupt-del" data-sid="${s.id}" data-ivid="${iv.id}"><svg class="icon-sm"><use href="#icon-x"/></svg></button></span>
        </div>
      `).join('');
      return `
        <div class="day-entry">
          <div class="day-entry-name"><span class="day-entry-dot" style="background:${s.color}"></span>${escapeHtml(s.name || '無題')}（${count}回分）</div>
          <div class="day-entry-amt ${isFuture ? 'pre' : ''}">${fromScaled(total)}${escapeHtml(s.currency)}</div>
        </div>
        ${interruptLines}
      `;
    }).join('');
  }

  const select = document.getElementById('interruptScenario');
  if (scenarios.length === 0) {
    interruptRow.style.display = 'none';
  } else {
    interruptRow.style.display = 'block';
    select.innerHTML = scenarios.map(s => `<option value="${s.id}">${escapeHtml(s.name || '無題')}</option>`).join('');
  }

  body.querySelectorAll('.interrupt-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sid = e.currentTarget.dataset.sid;
      const ivid = e.currentTarget.dataset.ivid;
      const s = scenarios.find(sc => sc.id === sid);
      if (s) {
        s.interrupts = (s.interrupts || []).filter(iv => iv.id !== ivid);
        await storageSet(scenarios);
        renderAll();
      }
    });
  });
}

function renderAll() {
  renderGrandTotal();
  renderLedgerList();
  renderYearSummary();
  renderCalendar();
  renderDayDetail();
}

/* ============ 描画: 年間サマリー ============ */
function renderYearSummary() {
  const el = document.getElementById('yearSummary');
  if (scenarios.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const yearStart = `${viewYear}-01-01`;
  const yearEndCap = `${viewYear}-12-31`;
  const today = todayStr();
  const cutoff = today < yearEndCap ? today : yearEndCap; // 未来分は数えない

  const prevDay = new Date(yearStart + 'T00:00:00');
  prevDay.setDate(prevDay.getDate() - 1);
  const beforeYearStr = `${prevDay.getFullYear()}-${String(prevDay.getMonth()+1).padStart(2,'0')}-${String(prevDay.getDate()).padStart(2,'0')}`;

  const byCurrency = {};
  scenarios.forEach(s => {
    if (cutoff < yearStart) return; // まだ今年に入ってない（未来開始）
    const uptoCutoff = totalAt(s, cutoff);
    const uptoBeforeYear = totalAt(s, beforeYearStr);
    const yearCount = uptoCutoff.count - uptoBeforeYear.count;
    const yearAmount = uptoCutoff.total - uptoBeforeYear.total;
    if (yearCount > 0 || yearAmount > 0n) {
      if (!byCurrency[s.currency]) byCurrency[s.currency] = { count: 0, total: 0n };
      byCurrency[s.currency].count += yearCount;
      byCurrency[s.currency].total += yearAmount;
    }
  });

  const currencies = Object.keys(byCurrency);
  if (currencies.length === 0) {
    el.innerHTML = `<span class="ys-label">${viewYear}年</span><span class="ys-nums">まだ記録なし</span>`;
    return;
  }
  const numsHtml = currencies.map(cur => {
    const d = byCurrency[cur];
    return `${fromScaled(d.total)}${escapeHtml(cur)}<span class="count">（${d.count}回分）</span>`;
  }).join('　');
  el.innerHTML = `<span class="ys-label">${viewYear}年 これまでの記帳</span><span class="ys-nums">${numsHtml}</span>`;
}

/* ============ フォーム：新規／編集共通 ============ */
const CUSTOM_COLORS_KEY = 'savings-ledger-custom-colors';
const MAX_CUSTOM_COLORS = 24;
let customColors = [];
let colorDeleteMode = false;
let colorsMarkedForDelete = new Set();

function loadCustomColors() {
  try {
    const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
    customColors = raw ? JSON.parse(raw) : [];
  } catch (e) {
    customColors = [];
  }
}

function saveCustomColors() {
  try {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(customColors));
  } catch (e) {
    console.error('カスタムカラーの保存に失敗しました', e);
  }
}

function setupColorPicker() {
  loadCustomColors();
  renderColorPicker();

  document.getElementById('customColor').addEventListener('change', (e) => {
    const color = e.target.value;
    if (customColors.length >= MAX_CUSTOM_COLORS) {
      alert(`カスタム色は${MAX_CUSTOM_COLORS}個まで。先にいくつか消してね`);
      return;
    }
    if (!customColors.includes(color) && !COLORS.includes(color)) {
      customColors.push(color);
      saveCustomColors();
    }
    renderColorPicker();
    setColorSelection(color);
  });
}

function renderColorPicker() {
  const picker = document.getElementById('colorPicker');
  const atLimit = customColors.length >= MAX_CUSTOM_COLORS;

  const presetDots = COLORS.map(c =>
    `<div class="color-dot" style="background:${c}" data-color="${c}"></div>`
  ).join('');

  const customDots = customColors.map(c => {
    const marked = colorsMarkedForDelete.has(c);
    return `
      <div class="color-dot custom-dot ${colorDeleteMode ? 'delete-mode' : ''} ${marked ? 'marked' : ''}" style="background:${c}" data-color="${c}">
        ${colorDeleteMode ? `<span class="dot-check"><svg class="icon-sm"><use href="#icon-check"/></svg></span>` : ''}
      </div>
    `;
  }).join('');

  const addBtn = `<button type="button" class="color-add-btn" id="colorAddBtn" title="${atLimit ? `カスタム色は${MAX_CUSTOM_COLORS}個まで。先に消してね` : 'カスタム色を追加'}" ${atLimit ? 'disabled' : ''}><svg class="icon-sm"><use href="#icon-plus"/></svg></button>`;

  const editBtn = customColors.length > 0
    ? `<button type="button" class="color-edit-btn ${colorDeleteMode ? 'active' : ''}" id="colorEditBtn" title="${colorDeleteMode ? '編集をやめる' : 'カスタム色を整理する'}"><svg class="icon-sm"><use href="#${colorDeleteMode ? 'icon-x' : 'icon-pencil'}"/></svg></button>`
    : '';

  picker.innerHTML = presetDots + customDots + addBtn + editBtn;

  picker.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const color = dot.dataset.color;
      if (colorDeleteMode && dot.classList.contains('custom-dot')) {
        if (colorsMarkedForDelete.has(color)) {
          colorsMarkedForDelete.delete(color);
        } else {
          colorsMarkedForDelete.add(color);
        }
        renderColorPicker();
      } else if (!colorDeleteMode) {
        setColorSelection(color);
      }
    });
  });

  const addBtnEl = document.getElementById('colorAddBtn');
  if (addBtnEl) {
    addBtnEl.addEventListener('click', () => {
      if (!atLimit) document.getElementById('customColor').click();
    });
  }

  const editBtnEl = document.getElementById('colorEditBtn');
  if (editBtnEl) {
    editBtnEl.addEventListener('click', () => {
      colorDeleteMode = !colorDeleteMode;
      colorsMarkedForDelete.clear();
      renderColorPicker();
      renderDeleteBar();
    });
  }

  renderDeleteBar();
  highlightSelectedDot();
}

function renderDeleteBar() {
  let bar = document.getElementById('colorDeleteBar');
  if (!colorDeleteMode) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'colorDeleteBar';
    bar.className = 'color-delete-bar';
    document.getElementById('colorPicker').insertAdjacentElement('afterend', bar);
  }
  const count = colorsMarkedForDelete.size;
  bar.innerHTML = `
    <span class="color-delete-count">${count > 0 ? `${count}個選択中` : '消したい色をタップして選んでね'}</span>
    <button type="button" class="color-delete-confirm" id="colorDeleteConfirm" ${count === 0 ? 'disabled' : ''}>
      <svg class="icon-sm"><use href="#icon-trash-2"/></svg> 削除
    </button>
  `;
  const confirmBtn = document.getElementById('colorDeleteConfirm');
  confirmBtn.addEventListener('click', () => {
    if (colorsMarkedForDelete.size === 0) return;
    const wasSelected = colorsMarkedForDelete.has(selectedColor);
    customColors = customColors.filter(c => !colorsMarkedForDelete.has(c));
    saveCustomColors();
    colorsMarkedForDelete.clear();
    colorDeleteMode = false;
    renderColorPicker();
    if (wasSelected) setColorSelection(COLORS[0]);
  });
}

function highlightSelectedDot() {
  document.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('selected', !colorDeleteMode && d.dataset.color === selectedColor);
  });
}

function setColorSelection(color) {
  selectedColor = color;
  const known = COLORS.includes(color) || customColors.includes(color);
  if (!known) {
    if (customColors.length < MAX_CUSTOM_COLORS) {
      customColors.push(color);
      saveCustomColors();
    }
    renderColorPicker();
    return; // renderColorPicker内でhighlightSelectedDotが呼ばれる
  }
  highlightSelectedDot();
}

function updateIntervalUI() {
  const type = document.getElementById('fIntervalType').value;
  document.getElementById('daysIntervalRow').style.display = (type === 'days') ? 'flex' : 'none';
  document.getElementById('monthlyDateRow').style.display = (type === 'monthlyDate') ? 'flex' : 'none';
}

document.getElementById('fIntervalType').addEventListener('change', updateIntervalUI);

function syncShortcutButtons() {
  const day = document.getElementById('fMonthDay').value;
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.day === day);
  });
}

document.querySelectorAll('.shortcut-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('fMonthDay').value = btn.dataset.day;
    syncShortcutButtons();
  });
});

document.getElementById('fMonthDay').addEventListener('input', syncShortcutButtons);

function resetForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = '記帳内容';
  document.getElementById('saveBtn').textContent = '記帳する';
  document.getElementById('fName').value = '';
  document.getElementById('fStart').value = todayStr();
  document.getElementById('fAmount').value = '';
  document.getElementById('fCurrency').value = '円';
  document.getElementById('fIntervalType').value = 'days';
  document.getElementById('fInterval').value = '1';
  document.getElementById('fMonthDay').value = '1';
  setColorSelection(COLORS[0]);
  updateIntervalUI();
  syncShortcutButtons();
}

function openFormForNew() {
  resetForm();
  document.getElementById('formCard').classList.add('open');
  document.getElementById('addToggle').style.display = 'none';
}

function openFormForEdit(id) {
  const s = scenarios.find(sc => sc.id === id);
  if (!s) return;
  editingId = id;
  document.getElementById('formTitle').textContent = '記帳内容を編集';
  document.getElementById('saveBtn').textContent = '更新する';
  document.getElementById('fName').value = s.name || '';
  document.getElementById('fStart').value = s.start;
  document.getElementById('fAmount').value = fromScaled(s.amountScaled).replace(/,/g, '');
  document.getElementById('fCurrency').value = s.currency;
  document.getElementById('fIntervalType').value = s.intervalType;
  document.getElementById('fInterval').value = s.interval || 1;
  document.getElementById('fMonthDay').value = s.monthDay || 1;
  setColorSelection(s.color);
  updateIntervalUI();
  syncShortcutButtons();
  document.getElementById('formCard').classList.add('open');
  document.getElementById('addToggle').style.display = 'none';
  document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  document.getElementById('formCard').classList.remove('open');
  document.getElementById('addToggle').style.display = 'block';
  editingId = null;
}

document.getElementById('addToggle').addEventListener('click', openFormForNew);
document.getElementById('cancelBtn').addEventListener('click', closeForm);

document.getElementById('saveBtn').addEventListener('click', async () => {
  const name = document.getElementById('fName').value.trim();
  const start = document.getElementById('fStart').value;
  const amountRaw = document.getElementById('fAmount').value.trim();
  const currency = document.getElementById('fCurrency').value.trim() || '円';
  const intervalType = document.getElementById('fIntervalType').value;
  const interval = parseInt(document.getElementById('fInterval').value) || 1;
  const monthDay = Math.min(31, Math.max(1, parseInt(document.getElementById('fMonthDay').value) || 1));

  const amountScaled = toScaled(amountRaw);
  if (!start || amountScaled === null || amountScaled <= 0n) {
    alert('開始日と金額をちゃんと入れてね');
    return;
  }
  if (intervalType === 'days' && interval <= 0) {
    alert('間隔（日数）は1以上にしてね');
    return;
  }

  if (editingId) {
    const s = scenarios.find(sc => sc.id === editingId);
    if (s) {
      s.name = name;
      s.start = start;
      s.amountScaled = amountScaled.toString();
      s.currency = currency;
      s.intervalType = intervalType;
      s.interval = interval;
      s.monthDay = monthDay;
      s.color = selectedColor;
    }
  } else {
    scenarios.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      name, start,
      amountScaled: amountScaled.toString(),
      currency, intervalType, interval, monthDay,
      color: selectedColor,
      interrupts: []
    });
  }

  await storageSet(scenarios);
  closeForm();
  renderAll();
});

document.getElementById('interruptAdd').addEventListener('click', async () => {
  if (!selectedDateStr) return;
  const sid = document.getElementById('interruptScenario').value;
  const amountScaled = toScaled(document.getElementById('interruptAmount').value);
  if (amountScaled === null || amountScaled === 0n) { alert('金額を入れてね'); return; }
  const s = scenarios.find(sc => sc.id === sid);
  if (!s) return;
  if (!s.interrupts) s.interrupts = [];
  s.interrupts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    date: selectedDateStr,
    amountScaled: amountScaled.toString()
  });
  await storageSet(scenarios);
  document.getElementById('interruptAmount').value = '';
  renderAll();
});

/* ============ CSV書き出し ============ */
document.getElementById('exportBtn').addEventListener('click', () => {
  if (scenarios.length === 0) {
    alert('まだ記帳が無いよ');
    return;
  }
  const today = todayStr();
  const rows = [['シナリオ名','開始日','1回あたりの額','通貨','間隔','今日時点の累計回数','割り込み合計','今日時点の累計額']];
  scenarios.forEach(s => {
    const { count, total, interruptTotal } = totalAt(s, today);
    rows.push([
      s.name || '無題', s.start, fromScaled(s.amountScaled), s.currency, intervalLabel(s), count, fromScaled(interruptTotal), fromScaled(total)
    ]);
  });
  rows.push([]);
  rows.push(['--- 割り込み記録 ---']);
  rows.push(['シナリオ名','日付','割り込み額']);
  scenarios.forEach(s => {
    (s.interrupts || []).forEach(iv => {
      rows.push([s.name || '無題', iv.date, fromScaled(iv.amountScaled)]);
    });
  });

  const csv = rows.map(r => r.map(cell => {
    const str = String(cell ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
  }).join(',')).join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `積んでたら台帳_${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ============ JSON書き出し（バックアップ用の本命） ============ */
document.getElementById('exportJsonBtn').addEventListener('click', () => {
  if (scenarios.length === 0) {
    alert('まだ記帳が無いよ');
    return;
  }
  const payload = { version: 2, exportedAt: todayStr(), scenarios };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `積んでたら台帳_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ============ JSONインポート ============ */
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = Array.isArray(payload) ? payload : payload.scenarios;
    if (!Array.isArray(incoming)) throw new Error('シナリオの配列が見つからない');

    // 簡易バリデーション：必須フィールドがあるものだけ通す
    const valid = incoming.filter(s => s && s.start && s.amountScaled !== undefined);
    if (valid.length === 0) {
      alert('読み込める記帳データが見つからなかったよ');
      return;
    }

    const mode = confirm(
      `${valid.length}件の記帳が見つかった。\nOK: 今のリストに追加する\nキャンセル: 今のリストを置き換える`
    ) ? 'merge' : 'replace';

    if (mode === 'replace') {
      if (!confirm('今の記帳を全部消して置き換える。本当にいい？')) return;
      scenarios = valid.map(s => ({ ...s, id: s.id || genId() }));
    } else {
      // ID重複は新規IDを振り直して両方残す
      const existingIds = new Set(scenarios.map(s => s.id));
      const merged = valid.map(s => existingIds.has(s.id) ? { ...s, id: genId() } : s);
      scenarios = scenarios.concat(merged);
    }

    await storageSet(scenarios);
    renderAll();
    alert('読み込み完了');
  } catch (err) {
    console.error(err);
    alert('読み込みに失敗した。ファイルが壊れてるかも');
  } finally {
    e.target.value = '';
  }
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ============ URLでシナリオ共有 ============ */
function shareScenarioUrl(id) {
  const s = scenarios.find(sc => sc.id === id);
  if (!s) return;
  const payload = {
    name: s.name, start: s.start, amountScaled: s.amountScaled,
    currency: s.currency, intervalType: s.intervalType,
    interval: s.interval, monthDay: s.monthDay, color: s.color
  };
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  const url = `${location.origin}${location.pathname}?share=${encoded}`;

  if (navigator.share) {
    navigator.share({ title: '積んでたら台帳', url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      alert('共有URLをコピーしたよ');
    }).catch(() => {
      prompt('このURLをコピーしてね', url);
    });
  } else {
    prompt('このURLをコピーしてね', url);
  }
}

// ページ読み込み時、?share= が付いていたらシナリオ取り込みを提案
function checkShareParam() {
  const params = new URLSearchParams(location.search);
  const encoded = params.get('share');
  if (!encoded) return;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
    const payload = JSON.parse(json);
    if (!payload.start || payload.amountScaled === undefined) return;
    const label = `${payload.name || '無題'}（${formatDateJP(payload.start)}から）`;
    if (confirm(`共有された記帳「${label}」を追加する？`)) {
      scenarios.push({
        id: genId(),
        name: payload.name || '',
        start: payload.start,
        amountScaled: payload.amountScaled,
        currency: payload.currency || '円',
        intervalType: payload.intervalType || 'days',
        interval: payload.interval || 1,
        monthDay: payload.monthDay || 1,
        color: payload.color || COLORS[0],
        interrupts: []
      });
      storageSet(scenarios).then(renderAll);
    }
    // URLをクリーンにしておく
    history.replaceState(null, '', location.pathname);
  } catch (err) {
    console.error('共有URLの読み込みに失敗', err);
  }
}

/* ============ 簡易通知（アプリを開いている間だけ） ============ */
let notifyEnabled = false;
let notifyTimer = null;

async function toggleNotify() {
  if (!('Notification' in window)) {
    alert('この環境では通知が使えないみたい');
    return;
  }
  if (!notifyEnabled) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert('通知が許可されなかったよ');
      return;
    }
    notifyEnabled = true;
    startNotifyWatch();
  } else {
    notifyEnabled = false;
    if (notifyTimer) clearInterval(notifyTimer);
  }
  updateNotifyBtn();
}

function updateNotifyBtn() {
  const btn = document.getElementById('notifyBtn');
  const state = document.getElementById('notifyState');
  if (notifyEnabled) {
    btn.classList.add('active');
    state.textContent = 'オン（開いてる間だけ）';
  } else {
    btn.classList.remove('active');
    state.textContent = 'オフ';
  }
}

function startNotifyWatch() {
  checkTodayDeposits(true);
  notifyTimer = setInterval(() => checkTodayDeposits(false), 60 * 60 * 1000);
}

let notifiedToday = {};
function checkTodayDeposits(isInitial) {
  const today = todayStr();
  if (notifiedToday.date !== today) notifiedToday = { date: today, ids: [] };

  scenarios.forEach(s => {
    if (isDepositDay(s, today) && !notifiedToday.ids.includes(s.id)) {
      notifiedToday.ids.push(s.id);
      if (!isInitial) {
        new Notification('積んでたら台帳', {
          body: `今日は「${s.name || '無題'}」の入金日ペースです`
        });
      }
    }
  });
}

document.getElementById('notifyBtn').addEventListener('click', toggleNotify);

document.getElementById('prevMonth').addEventListener('click', () => {
  if (yearViewOpen) {
    viewYear--;
    renderYearGrid();
  } else {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  }
});
document.getElementById('nextMonth').addEventListener('click', () => {
  if (yearViewOpen) {
    viewYear++;
    renderYearGrid();
  } else {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  }
});

/* ============ 初期化 ============ */
async function init() {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  setupColorPicker();
  setupJumpSelects();
  scenarios = await storageGet();
  renderAll();
  checkShareParam();
}

init();
