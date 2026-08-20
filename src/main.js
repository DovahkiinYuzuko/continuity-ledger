import {
  initI18n,
  t,
  formatDateLocale,
  applyI18n
} from './i18n.js';
import {
  toScaled,
  fromScaled,
  todayStr,
  daysInMonth,
  isDepositDay,
  totalAt,
  interruptsOn,
  intervalLabel,
  calculateTargetDate
} from './math.js';
import {
  DEFAULT_COLORS,
  MAX_CUSTOM_COLORS,
  genId,
  storageGet,
  storageSet,
  getCustomColors,
  saveCustomColors
} from './storage.js';
import {
  exportCsv,
  exportJson,
  importJson,
  shareScenarioUrl,
  checkShareParam
} from './export.js';
import {
  initChart,
  renderChart
} from './chart.js';

let scenarios = [];
let selectedColor = DEFAULT_COLORS[0];
let customColors = [];
let colorDeleteMode = false;
let colorsMarkedForDelete = new Set();

let viewYear, viewMonth; // viewMonth: 0-indexed
let selectedDateStr = null;
let editingId = null; // 編集中のシナリオID（null=新規）
let yearViewOpen = false;

let notifyEnabled = false;
let notifyTimer = null;
let notifiedToday = { date: '', ids: [] };

/* ============ HTMLエスケープ ============ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============ 描画: 全シナリオ合算 ============ */
function renderGrandTotal() {
  const el = document.getElementById('grandTotal');
  if (!el) return;
  if (scenarios.length < 2) {
    el.classList.remove('show');
    return;
  }
  const today = todayStr();
  const byCurrency = {};
  scenarios.forEach(s => {
    const { total } = totalAt(s, today);
    const cur = s.currency || t('form.default_currency');
    byCurrency[cur] = (byCurrency[cur] || 0n) + total;
  });
  const currencies = Object.keys(byCurrency);
  el.classList.add('show');
  const label = `<div class="label">${escapeHtml(t('grand_total.label'))}</div>`;
  if (currencies.length === 1) {
    const cur = currencies[0];
    el.innerHTML = `${label}<div class="num">${fromScaled(byCurrency[cur])}<span class="cur">${escapeHtml(cur)}</span></div>`;
  } else {
    el.innerHTML = label + currencies.map(cur =>
      `<div class="num" style="font-size:18px">${fromScaled(byCurrency[cur])}<span class="cur">${escapeHtml(cur)}</span></div>`
    ).join('');
  }
}

/* ============ 描画: シナリオ一覧 ============ */
function renderLedgerList() {
  const list = document.getElementById('ledgerList');
  if (!list) return;
  if (scenarios.length === 0) {
    list.innerHTML = `<div class="empty-note">${t('ledger.empty')}</div>`;
    return;
  }
  const today = todayStr();
  list.innerHTML = scenarios.map(s => {
    const { count, total } = totalAt(s, today);
    const allInterrupts = (s.interrupts || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const futureInterrupts = allInterrupts.filter(iv => iv.date > today);
    const futureTotal = futureInterrupts.reduce((sum, iv) => sum + BigInt(iv.amountScaled), 0n);
    const pendingLabel = futureTotal > 0n
      ? `<span class="ledger-pending">${t('ledger.pending', { amount: fromScaled(futureTotal) })}</span>`
      : '';

    // 目標金額シミュレーター表示
    let targetBadgeHtml = '';
    if (s.targetAmountScaled) {
      const targetRes = calculateTargetDate(s, s.targetAmountScaled);
      if (targetRes) {
        const targetFormatted = fromScaled(s.targetAmountScaled);
        if (targetRes.reached) {
          targetBadgeHtml = `<div class="ledger-target-badge reached"><svg class="icon-sm"><use href="#icon-target"/></svg> ${t('ledger.target_reached', { target: targetFormatted, currency: s.currency })}</div>`;
        } else {
          targetBadgeHtml = `<div class="ledger-target-badge"><svg class="icon-sm"><use href="#icon-target"/></svg> ${t('ledger.target_reach', { target: targetFormatted, currency: s.currency, date: formatDateLocale(targetRes.targetDateStr), days: targetRes.remainingDays })}</div>`;
        }
      }
    }

    const metaText = t('ledger.meta_format', {
      start: formatDateLocale(s.start),
      interval: intervalLabel(s),
      amount: fromScaled(s.amountScaled),
      currency: escapeHtml(s.currency),
      count: count
    });

    const interruptsBody = allInterrupts.length === 0
      ? `<div class="ledger-iv-empty">${escapeHtml(t('ledger.interrupts_empty'))}</div>`
      : allInterrupts.map(iv => {
          const isFuture = iv.date > today;
          return `
            <div class="ledger-iv-entry ${isFuture ? 'future' : ''}">
              <span class="ledger-iv-date">${formatDateLocale(iv.date)}</span>
              <span>
                <span class="ledger-iv-amt">+${fromScaled(iv.amountScaled)}${escapeHtml(s.currency)}</span>
                <button class="ledger-iv-del" data-sid="${s.id}" data-ivid="${iv.id}" title="${t('ledger.btn_delete')}"><svg class="icon-sm"><use href="#icon-x"/></svg></button>
              </span>
            </div>
          `;
        }).join('');

    return `
      <details class="ledger-card" style="--tag-color:${s.color}">
        <summary>
          <div class="ledger-info">
            <div class="ledger-name">${escapeHtml(s.name || t('ledger.untitled'))}</div>
            <div class="ledger-meta">${metaText}</div>
            ${targetBadgeHtml}
          </div>
          <div class="ledger-amount">
            <span class="num">${fromScaled(total)}</span><span class="cur">${escapeHtml(s.currency)}</span>
            ${pendingLabel}
          </div>
          <div class="ledger-actions">
            <button class="ledger-copy" data-id="${s.id}" title="${t('ledger.btn_copy')}"><svg class="icon-sm"><use href="#icon-copy"/></svg></button>
            <button class="ledger-share" data-id="${s.id}" title="${t('ledger.btn_share')}"><svg class="icon-sm"><use href="#icon-share"/></svg></button>
            <button class="ledger-edit" data-id="${s.id}" title="${t('ledger.btn_edit')}"><svg class="icon-sm"><use href="#icon-pencil"/></svg></button>
            <button class="ledger-del" data-id="${s.id}" title="${t('ledger.btn_delete')}"><svg class="icon-sm"><use href="#icon-x"/></svg></button>
          </div>
        </summary>
        <div class="ledger-interrupts">${interruptsBody}</div>
      </details>
    `;
  }).join('');

  // 複製（Duplicate）機能
  list.querySelectorAll('.ledger-copy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      const target = scenarios.find(s => s.id === id);
      if (!target) return;

      const duplicated = {
        ...JSON.parse(JSON.stringify(target)),
        id: genId(),
        name: (target.name ? target.name : t('ledger.untitled')) + t('form.copy_suffix')
      };
      scenarios.push(duplicated);
      await storageSet(scenarios);
      renderAll();
    });
  });

  list.querySelectorAll('.ledger-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (!confirm(t('ledger.confirm_delete'))) return;
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
      const target = scenarios.find(s => s.id === id);
      if (target) shareScenarioUrl(target);
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
  if (title) {
    title.textContent = t('calendar.month_title', { year: viewYear, month: viewMonth + 1 });
  }
  syncJumpSelects();

  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const dows = t('calendar.dow');
  const dowList = Array.isArray(dows) ? dows : ['日', '月', '火', '水', '木', '金', '土'];
  dowList.forEach(d => {
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
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
  if (!yearSel || !monthSel) return;

  const nowYear = new Date().getFullYear();
  const yearRange = [];
  for (let y = nowYear - 10; y <= nowYear + 10; y++) yearRange.push(y);
  yearSel.innerHTML = yearRange.map(y => `<option value="${y}">${t('calendar.jump_year', { year: y })}</option>`).join('');
  monthSel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${t('calendar.jump_month', { month: i + 1 })}</option>`).join('');

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
  if (yearSel && yearSel.value !== String(viewYear)) yearSel.value = String(viewYear);
  if (monthSel && monthSel.value !== String(viewMonth)) monthSel.value = String(viewMonth);
  if (monthSel) monthSel.style.display = yearViewOpen ? 'none' : '';
}

/* ============ 年間プレビュー ============ */
function renderYearGrid() {
  const title = document.getElementById('calTitle');
  if (title) title.textContent = t('calendar.year_title', { year: viewYear });
  syncJumpSelects();

  const grid = document.getElementById('yearGrid');
  if (!grid) return;
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
      const dateStr = `${viewYear}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasDeposit = scenarios.some(s => isDepositDay(s, dateStr));
      miniCells += `<div class="year-grid-mini-cell ${hasDeposit ? 'has-deposit' : ''}"></div>`;
    }

    const monthDiv = document.createElement('div');
    monthDiv.className = `year-grid-month ${isCurrentMonth ? 'current' : ''}`;
    monthDiv.innerHTML = `
      <div class="year-grid-month-label">${t('calendar.month_label', { month: m + 1 })}</div>
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

/* ============ 日付詳細パネル ============ */
function renderDayDetail() {
  const panel = document.getElementById('dayDetail');
  const interruptRow = document.getElementById('interruptRow');
  if (!panel || !interruptRow) return;

  if (!selectedDateStr || scenarios.length === 0) {
    panel.classList.remove('open');
    return;
  }
  panel.classList.add('open');
  document.getElementById('dayDetailDate').textContent = formatDateLocale(selectedDateStr);
  const body = document.getElementById('dayDetailBody');

  const relevant = scenarios.filter(s => selectedDateStr >= s.start);
  if (relevant.length === 0) {
    body.innerHTML = `<div class="day-detail-empty">${escapeHtml(t('day_detail.empty_no_start'))}</div>`;
  } else {
    body.innerHTML = relevant.map(s => {
      const { count, total } = totalAt(s, selectedDateStr);
      const isFuture = selectedDateStr > todayStr();
      const todaysInterrupts = interruptsOn(s, selectedDateStr);
      const interruptLines = todaysInterrupts.map(iv => `
        <div class="interrupt-entry">
          <span>${escapeHtml(t('day_detail.interrupt_prefix', { name: s.name || t('ledger.untitled') }))}</span>
          <span><span class="amt">+${fromScaled(iv.amountScaled)}${escapeHtml(s.currency)}</span>
          <button class="interrupt-del" data-sid="${s.id}" data-ivid="${iv.id}" title="${t('ledger.btn_delete')}"><svg class="icon-sm"><use href="#icon-x"/></svg></button></span>
        </div>
      `).join('');
      return `
        <div class="day-entry">
          <div class="day-entry-name"><span class="day-entry-dot" style="background:${s.color}"></span>${escapeHtml(s.name || t('ledger.untitled'))}${t('day_detail.times_count', { count })}</div>
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
    select.innerHTML = scenarios.map(s => `<option value="${s.id}">${escapeHtml(s.name || t('ledger.untitled'))}</option>`).join('');
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

/* ============ 年間サマリー ============ */
function renderYearSummary() {
  const el = document.getElementById('yearSummary');
  if (!el) return;
  if (scenarios.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const yearStart = `${viewYear}-01-01`;
  const yearEndCap = `${viewYear}-12-31`;
  const today = todayStr();
  const cutoff = today < yearEndCap ? today : yearEndCap;

  const prevDay = new Date(yearStart + 'T00:00:00');
  prevDay.setDate(prevDay.getDate() - 1);
  const beforeYearStr = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')}`;

  const byCurrency = {};
  scenarios.forEach(s => {
    if (cutoff < yearStart) return;
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
    el.innerHTML = `<span class="ys-label">${t('calendar.jump_year', { year: viewYear })}</span><span class="ys-nums">${escapeHtml(t('year_summary.empty'))}</span>`;
    return;
  }
  const numsHtml = currencies.map(cur => {
    const d = byCurrency[cur];
    return `${fromScaled(d.total)}${escapeHtml(cur)}<span class="count">${t('year_summary.count_format', { count: d.count })}</span>`;
  }).join('　');
  el.innerHTML = `<span class="ys-label">${escapeHtml(t('year_summary.title', { year: viewYear }))}</span><span class="ys-nums">${numsHtml}</span>`;
}

/* ============ カラーピッカー ============ */
function setupColorPicker() {
  customColors = getCustomColors();
  renderColorPicker();

  document.getElementById('customColor').addEventListener('change', (e) => {
    const color = e.target.value;
    if (customColors.length >= MAX_CUSTOM_COLORS) {
      alert(t('form.alert_color_limit', { max: MAX_CUSTOM_COLORS }));
      return;
    }
    if (!customColors.includes(color) && !DEFAULT_COLORS.includes(color)) {
      customColors.push(color);
      saveCustomColors(customColors);
    }
    renderColorPicker();
    setColorSelection(color);
  });
}

function renderColorPicker() {
  const picker = document.getElementById('colorPicker');
  if (!picker) return;
  const atLimit = customColors.length >= MAX_CUSTOM_COLORS;

  const presetDots = DEFAULT_COLORS.map(c =>
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

  const addTooltip = atLimit ? t('form.tooltip_color_limit', { max: MAX_CUSTOM_COLORS }) : t('form.tooltip_color_add');
  const addBtn = `<button type="button" class="color-add-btn" id="colorAddBtn" title="${addTooltip}" ${atLimit ? 'disabled' : ''}><svg class="icon-sm"><use href="#icon-plus"/></svg></button>`;

  const editTooltip = colorDeleteMode ? t('form.tooltip_color_cancel') : t('form.tooltip_color_edit');
  const editBtn = customColors.length > 0
    ? `<button type="button" class="color-edit-btn ${colorDeleteMode ? 'active' : ''}" id="colorEditBtn" title="${editTooltip}"><svg class="icon-sm"><use href="#${colorDeleteMode ? 'icon-x' : 'icon-pencil'}"/></svg></button>`
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
    <span class="color-delete-count">${count > 0 ? t('form.color_delete_count', { count }) : t('form.color_delete_prompt')}</span>
    <button type="button" class="color-delete-confirm" id="colorDeleteConfirm" ${count === 0 ? 'disabled' : ''}>
      <svg class="icon-sm"><use href="#icon-trash-2"/></svg> ${t('form.btn_color_delete')}
    </button>
  `;
  const confirmBtn = document.getElementById('colorDeleteConfirm');
  confirmBtn.addEventListener('click', () => {
    if (colorsMarkedForDelete.size === 0) return;
    const wasSelected = colorsMarkedForDelete.has(selectedColor);
    customColors = customColors.filter(c => !colorsMarkedForDelete.has(c));
    saveCustomColors(customColors);
    colorsMarkedForDelete.clear();
    colorDeleteMode = false;
    renderColorPicker();
    if (wasSelected) setColorSelection(DEFAULT_COLORS[0]);
  });
}

function highlightSelectedDot() {
  document.querySelectorAll('.color-dot').forEach(d => {
    d.classList.toggle('selected', !colorDeleteMode && d.dataset.color === selectedColor);
  });
}

function setColorSelection(color) {
  selectedColor = color;
  const known = DEFAULT_COLORS.includes(color) || customColors.includes(color);
  if (!known) {
    if (customColors.length < MAX_CUSTOM_COLORS) {
      customColors.push(color);
      saveCustomColors(customColors);
    }
    renderColorPicker();
    return;
  }
  highlightSelectedDot();
}

/* ============ フォーム制御 ============ */
function updateIntervalUI() {
  const type = document.getElementById('fIntervalType').value;
  document.getElementById('daysIntervalRow').style.display = (type === 'days') ? 'flex' : 'none';
  document.getElementById('monthlyDateRow').style.display = (type === 'monthlyDate') ? 'flex' : 'none';
}

function syncShortcutButtons() {
  const day = document.getElementById('fMonthDay').value;
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.day === day);
  });
}

function resetForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = t('form.title_new');
  document.getElementById('saveBtn').textContent = t('form.btn_save_new');
  document.getElementById('fName').value = '';
  document.getElementById('fStart').value = todayStr();
  document.getElementById('fAmount').value = '';
  document.getElementById('fTargetAmount').value = '';
  document.getElementById('fCurrency').value = t('form.default_currency');
  document.getElementById('fIntervalType').value = 'days';
  document.getElementById('fInterval').value = '1';
  document.getElementById('fMonthDay').value = '1';
  setColorSelection(DEFAULT_COLORS[0]);
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
  document.getElementById('formTitle').textContent = t('form.title_edit');
  document.getElementById('saveBtn').textContent = t('form.btn_save_edit');
  document.getElementById('fName').value = s.name || '';
  document.getElementById('fStart').value = s.start;
  document.getElementById('fAmount').value = fromScaled(s.amountScaled).replace(/,/g, '');
  document.getElementById('fTargetAmount').value = s.targetAmountScaled ? fromScaled(s.targetAmountScaled).replace(/,/g, '') : '';
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

/* ============ 通知機能 ============ */
async function toggleNotify() {
  if (!('Notification' in window)) {
    alert(t('notify.alert_unsupported'));
    return;
  }
  if (!notifyEnabled) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert(t('notify.alert_denied'));
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
    state.textContent = t('tools.notify_on');
  } else {
    btn.classList.remove('active');
    state.textContent = t('tools.notify_off');
  }
}

function startNotifyWatch() {
  checkTodayDeposits(true);
  notifyTimer = setInterval(() => checkTodayDeposits(false), 60 * 60 * 1000);
}

function checkTodayDeposits(isInitial) {
  const today = todayStr();
  if (notifiedToday.date !== today) notifiedToday = { date: today, ids: [] };

  scenarios.forEach(s => {
    if (isDepositDay(s, today) && !notifiedToday.ids.includes(s.id)) {
      notifiedToday.ids.push(s.id);
      if (!isInitial) {
        new Notification(t('app.title'), {
          body: t('notify.body', { name: s.name || t('ledger.untitled') })
        });
      }
    }
  });
}

/* ============ 全体再描画 ============ */
export function renderAll() {
  renderGrandTotal();
  renderLedgerList();
  renderYearSummary();
  if (yearViewOpen) {
    renderYearGrid();
  } else {
    renderCalendar();
  }
  renderDayDetail();
  renderChart(scenarios);
}

/* ============ イベントバインディング ============ */
function setupEvents() {
  document.getElementById('fIntervalType').addEventListener('change', updateIntervalUI);

  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('fMonthDay').value = btn.dataset.day;
      syncShortcutButtons();
    });
  });

  document.getElementById('fMonthDay').addEventListener('input', syncShortcutButtons);

  document.getElementById('addToggle').addEventListener('click', openFormForNew);
  document.getElementById('cancelBtn').addEventListener('click', closeForm);

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const start = document.getElementById('fStart').value;
    const amountRaw = document.getElementById('fAmount').value.trim();
    const targetAmountRaw = document.getElementById('fTargetAmount').value.trim();
    const currency = document.getElementById('fCurrency').value.trim() || t('form.default_currency');
    const intervalType = document.getElementById('fIntervalType').value;
    const interval = parseInt(document.getElementById('fInterval').value) || 1;
    const monthDay = Math.min(31, Math.max(1, parseInt(document.getElementById('fMonthDay').value) || 1));

    const amountScaled = toScaled(amountRaw);
    if (!start || amountScaled === null || amountScaled <= 0n) {
      alert(t('form.alert_invalid_input'));
      return;
    }
    if (intervalType === 'days' && interval <= 0) {
      alert(t('form.alert_invalid_interval'));
      return;
    }

    const targetAmountScaled = targetAmountRaw ? toScaled(targetAmountRaw)?.toString() || null : null;

    if (editingId) {
      const s = scenarios.find(sc => sc.id === editingId);
      if (s) {
        s.name = name;
        s.start = start;
        s.amountScaled = amountScaled.toString();
        s.targetAmountScaled = targetAmountScaled;
        s.currency = currency;
        s.intervalType = intervalType;
        s.interval = interval;
        s.monthDay = monthDay;
        s.color = selectedColor;
      }
    } else {
      scenarios.push({
        id: genId(),
        name,
        start,
        amountScaled: amountScaled.toString(),
        targetAmountScaled,
        currency,
        intervalType,
        interval,
        monthDay,
        color: selectedColor,
        interrupts: []
      });
    }

    await storageSet(scenarios);
    closeForm();
    renderAll();
  });

  // 割り込み追加
  document.getElementById('interruptAdd').addEventListener('click', async () => {
    if (!selectedDateStr) return;
    const sid = document.getElementById('interruptScenario').value;
    const amountScaled = toScaled(document.getElementById('interruptAmount').value);
    if (amountScaled === null || amountScaled === 0n) {
      alert(t('day_detail.alert_interrupt_amount'));
      return;
    }
    const s = scenarios.find(sc => sc.id === sid);
    if (!s) return;
    if (!s.interrupts) s.interrupts = [];
    s.interrupts.push({
      id: genId(),
      date: selectedDateStr,
      amountScaled: amountScaled.toString()
    });
    await storageSet(scenarios);
    document.getElementById('interruptAmount').value = '';
    renderAll();
  });

  // ツールボタン
  document.getElementById('notifyBtn').addEventListener('click', toggleNotify);
  document.getElementById('exportBtn').addEventListener('click', () => exportCsv(scenarios));
  document.getElementById('exportJsonBtn').addEventListener('click', () => exportJson(scenarios));
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', (e) => {
    importJson(e.target.files[0], scenarios, (updated) => {
      scenarios = updated;
      renderAll();
    });
    e.target.value = '';
  });

  // カレンダー操作
  document.getElementById('todayBtn').addEventListener('click', () => {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    selectedDateStr = null;
    if (yearViewOpen) renderYearGrid(); else renderCalendar();
    renderDayDetail();
  });

  document.getElementById('yearViewBtn').addEventListener('click', () => {
    yearViewOpen = !yearViewOpen;
    document.getElementById('yearViewBtn').classList.toggle('active', yearViewOpen);
    document.getElementById('calGrid').style.display = yearViewOpen ? 'none' : 'grid';
    document.getElementById('yearGrid').style.display = yearViewOpen ? 'grid' : 'none';
    syncJumpSelects();
    if (yearViewOpen) renderYearGrid(); else renderCalendar();
  });

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
}

/* ============ アプリ初期化 ============ */
async function init() {
  await initI18n();

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  const canvas = document.getElementById('chartCanvas');
  const container = document.getElementById('chartContainer');
  if (canvas && container) {
    initChart(canvas, container);
  }

  setupColorPicker();
  setupJumpSelects();
  setupEvents();

  scenarios = await storageGet();
  renderAll();

  await checkShareParam(async (newScenario) => {
    scenarios.push(newScenario);
    await storageSet(scenarios);
    renderAll();
  });
}

init();
