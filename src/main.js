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
  calculateTargetDate,
  calculateRequiredAmountPerDeposit
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
import {
  STATES,
  EVENTS,
  fsm
} from './fsm.js';

let scenarios = [];
let selectedColor = DEFAULT_COLORS[0];
let customColors = [];

let notifyEnabled = false;
let notifyTimer = null;
let notifiedToday = { date: '', ids: [] };

// Pointer Events ドラッグ操作用
let pointerStartX = 0;
let pointerStartY = 0;
let isPointerDragging = false;
let pointerDeltaX = 0;

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
  list.innerHTML = scenarios.map((s, index) => {
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

    const endedMeta = s.end ? ` ${t('ledger.ended_meta', { end: formatDateLocale(s.end) })}` : '';
    const metaText = t('ledger.meta_format', {
      start: formatDateLocale(s.start),
      interval: intervalLabel(s),
      amount: fromScaled(s.amountScaled),
      currency: escapeHtml(s.currency),
      count: count
    }) + endedMeta;

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

    const isFirst = index === 0;
    const isLast = index === scenarios.length - 1;

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
            ${!isFirst ? `<button class="ledger-move-up" data-index="${index}" title="${t('ledger.btn_move_up')}"><svg class="icon-sm"><use href="#icon-chevron-up"/></svg></button>` : ''}
            ${!isLast ? `<button class="ledger-move-down" data-index="${index}" title="${t('ledger.btn_move_down')}"><svg class="icon-sm"><use href="#icon-chevron-down"/></svg></button>` : ''}
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
}

/* ============ 描画: カレンダー ============ */
function renderCalendar() {
  const ctx = fsm.getContext();
  const title = document.getElementById('calTitle');
  if (title) {
    title.textContent = t('calendar.month_title', { year: ctx.viewYear, month: ctx.viewMonth + 1 });
  }
  syncJumpSelects();

  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const dows = t('calendar.dow');
  const dowList = Array.isArray(dows) ? dows : ['日', '月', '火', '水', '木', '金', '土'];
  dowList.forEach((d, idx) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    if (idx === 0) el.classList.add('sun');
    if (idx === 6) el.classList.add('sat');
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(ctx.viewYear, ctx.viewMonth, 1);
  const startWeekday = firstDay.getDay();
  const lastDate = new Date(ctx.viewYear, ctx.viewMonth + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < startWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }

  const tooltipEl = document.getElementById('calTooltip');

  for (let day = 1; day <= lastDate; day++) {
    const dateStr = `${ctx.viewYear}-${String(ctx.viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cellDate = new Date(ctx.viewYear, ctx.viewMonth, day);
    const dayOfWeek = cellDate.getDay();

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (dayOfWeek === 0) cell.classList.add('sun');
    if (dayOfWeek === 6) cell.classList.add('sat');
    if (dateStr === today) cell.classList.add('today');
    if (dateStr === ctx.selectedDateStr) cell.classList.add('selected');
    cell.dataset.date = dateStr;

    const depositScenarios = scenarios.filter(s => isDepositDay(s, dateStr));
    const interrupts = scenarios.flatMap(s => interruptsOn(s, dateStr).map(iv => ({ ...iv, scenarioName: s.name, currency: s.currency, color: s.color })));

    cell.innerHTML = `
      <div class="cal-daynum">${day}</div>
      <div class="cal-marks">${depositScenarios.map(m => `<span class="cal-mark" style="background:${m.color}"></span>`).join('')}</div>
    `;

    // ツールチップイベント
    if (depositScenarios.length > 0 || interrupts.length > 0) {
      cell.addEventListener('mouseenter', (e) => {
        if (!tooltipEl) return;
        const totalScaledSum = depositScenarios.reduce((sum, s) => sum + BigInt(s.amountScaled), 0n) +
                               interrupts.reduce((sum, iv) => sum + BigInt(iv.amountScaled), 0n);
        const cur = depositScenarios[0]?.currency || interrupts[0]?.currency || '';
        const count = depositScenarios.length + interrupts.length;

        tooltipEl.textContent = `${formatDateLocale(dateStr)}: ${t('calendar.tooltip_total', { total: fromScaled(totalScaledSum), currency: cur, count })}`;
        tooltipEl.style.display = 'block';

        const rect = cell.getBoundingClientRect();
        tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
        tooltipEl.style.top = `${rect.top}px`;
      });

      cell.addEventListener('mouseleave', () => {
        if (tooltipEl) tooltipEl.style.display = 'none';
      });
    }

    cell.addEventListener('click', () => {
      const nextDate = (ctx.selectedDateStr === dateStr) ? null : dateStr;
      if (nextDate) {
        fsm.dispatch(EVENTS.SELECT_DATE, { dateStr: nextDate });
      } else {
        fsm.dispatch(EVENTS.DESELECT_DATE);
      }
    });

    grid.appendChild(cell);
  }
}

/* ============ 年月ジャンプ（1900年〜超長期動的スパン） ============ */
function setupJumpSelects() {
  const yearSel = document.getElementById('jumpYear');
  const monthSel = document.getElementById('jumpMonth');
  if (!yearSel || !monthSel) return;

  const nowYear = new Date().getFullYear();
  const minBaseYear = 1900; // 20世紀開始
  let maxBaseYear = nowYear + 50;

  // 登録シナリオの年を包含
  scenarios.forEach(s => {
    if (s.start) {
      const sy = parseInt(s.start.slice(0, 4), 10);
      if (sy > maxBaseYear) maxBaseYear = sy + 10;
    }
    if (s.end) {
      const ey = parseInt(s.end.slice(0, 4), 10);
      if (ey > maxBaseYear) maxBaseYear = ey + 10;
    }
  });

  const ctx = fsm.getContext();
  if (ctx.viewYear > maxBaseYear) maxBaseYear = ctx.viewYear + 10;
  let startY = Math.min(minBaseYear, ctx.viewYear - 5);

  const yearRange = [];
  for (let y = startY; y <= maxBaseYear; y++) yearRange.push(y);

  yearSel.innerHTML = yearRange.map(y => `<option value="${y}">${t('calendar.jump_year', { year: y })}</option>`).join('');
  monthSel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${t('calendar.jump_month', { month: i + 1 })}</option>`).join('');

  yearSel.addEventListener('change', () => {
    fsm.dispatch(EVENTS.SET_VIEW_YEAR, { year: parseInt(yearSel.value, 10) });
  });
  monthSel.addEventListener('change', () => {
    fsm.dispatch(EVENTS.SET_VIEW_MONTH, { month: parseInt(monthSel.value, 10) });
  });
}

function syncJumpSelects() {
  const yearSel = document.getElementById('jumpYear');
  const monthSel = document.getElementById('jumpMonth');
  const ctx = fsm.getContext();

  if (yearSel) {
    // 選択肢に現在のviewYearがない場合は動的にoptionを追加
    if (!yearSel.querySelector(`option[value="${ctx.viewYear}"]`)) {
      const opt = document.createElement('option');
      opt.value = String(ctx.viewYear);
      opt.textContent = t('calendar.jump_year', { year: ctx.viewYear });
      yearSel.appendChild(opt);
    }
    if (yearSel.value !== String(ctx.viewYear)) yearSel.value = String(ctx.viewYear);
  }
  if (monthSel && monthSel.value !== String(ctx.viewMonth)) monthSel.value = String(ctx.viewMonth);
  if (monthSel) monthSel.style.display = ctx.isYearView ? 'none' : '';
}

/* ============ 年間プレビュー ============ */
function renderYearGrid() {
  const ctx = fsm.getContext();
  const title = document.getElementById('calTitle');
  if (title) title.textContent = t('calendar.year_title', { year: ctx.viewYear });
  syncJumpSelects();

  const grid = document.getElementById('yearGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const today = todayStr();
  const [currentY, currentM] = today.split('-').map(Number);

  for (let m = 0; m < 12; m++) {
    const monthCard = document.createElement('div');
    monthCard.className = 'year-grid-month';
    if (ctx.viewYear === currentY && m === currentM - 1) {
      monthCard.classList.add('current');
    }

    const firstDay = new Date(ctx.viewYear, m, 1);
    const startWeekday = firstDay.getDay();
    const lastDate = new Date(ctx.viewYear, m + 1, 0).getDate();

    let miniCellsHtml = '';
    for (let b = 0; b < startWeekday; b++) {
      miniCellsHtml += '<div class="year-grid-mini-cell blank"></div>';
    }

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${ctx.viewYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasDeposit = scenarios.some(s => isDepositDay(s, dateStr));
      miniCellsHtml += `<div class="year-grid-mini-cell ${hasDeposit ? 'has-deposit' : ''}" style="${hasDeposit ? `background:${scenarios.find(s => isDepositDay(s, dateStr))?.color || '#a4402f'}` : ''}"></div>`;
    }

    monthCard.innerHTML = `
      <div class="year-grid-month-label">${t('calendar.month_label', { month: m + 1 })}</div>
      <div class="year-grid-mini">${miniCellsHtml}</div>
    `;

    monthCard.addEventListener('click', () => {
      fsm.dispatch(EVENTS.SET_VIEW_MONTH, { month: m });
      fsm.dispatch(EVENTS.TOGGLE_YEAR_VIEW);
    });

    grid.appendChild(monthCard);
  }
}

/* ============ 日付詳細パネル ============ */
function renderDayDetail() {
  const panel = document.getElementById('dayDetail');
  const dateEl = document.getElementById('dayDetailDate');
  const bodyEl = document.getElementById('dayDetailBody');
  const interruptScenarioSel = document.getElementById('interruptScenario');
  if (!panel || !dateEl || !bodyEl) return;

  const ctx = fsm.getContext();
  if (!ctx.selectedDateStr) {
    panel.classList.remove('open');
    return;
  }

  panel.classList.add('open');
  dateEl.textContent = formatDateLocale(ctx.selectedDateStr);

  const activeScenariosOnDate = scenarios.filter(s => s.start <= ctx.selectedDateStr && (!s.end || s.end >= ctx.selectedDateStr));
  if (activeScenariosOnDate.length === 0) {
    bodyEl.innerHTML = `<div class="day-detail-empty">${escapeHtml(t('day_detail.empty_no_start'))}</div>`;
  } else {
    bodyEl.innerHTML = activeScenariosOnDate.map(s => {
      const isDeposit = isDepositDay(s, ctx.selectedDateStr);
      const ivs = interruptsOn(s, ctx.selectedDateStr);
      const currentCount = totalAt(s, ctx.selectedDateStr).count;

      const regularRow = isDeposit
        ? `<div class="day-entry">
            <div class="day-entry-name">
              <span class="day-entry-dot" style="background:${s.color}"></span>
              <span>${escapeHtml(s.name || t('ledger.untitled'))}<span style="font-size:11px;color:var(--ink-faint);margin-left:4px">${t('day_detail.times_count', { count: currentCount })}</span></span>
            </div>
            <div class="day-entry-amt">+${fromScaled(s.amountScaled)}${escapeHtml(s.currency)}</div>
          </div>`
        : `<div class="day-entry">
            <div class="day-entry-name">
              <span class="day-entry-dot" style="background:${s.color};opacity:0.3"></span>
              <span style="color:var(--ink-faint)">${escapeHtml(s.name || t('ledger.untitled'))}</span>
            </div>
            <div class="day-entry-amt pre">-</div>
          </div>`;

      const interruptRows = ivs.map(iv => `
        <div class="day-entry" style="padding-left:14px">
          <div class="day-entry-name" style="font-size:12px">
            <span>${t('day_detail.interrupt_prefix', { name: escapeHtml(s.name || t('ledger.untitled')) })}</span>
          </div>
          <div class="day-entry-amt">+${fromScaled(iv.amountScaled)}${escapeHtml(s.currency)}</div>
        </div>
      `).join('');

      return regularRow + interruptRows;
    }).join('');
  }

  if (interruptScenarioSel) {
    interruptScenarioSel.innerHTML = scenarios.map(s =>
      `<option value="${s.id}">${escapeHtml(s.name || t('ledger.untitled'))}</option>`
    ).join('');
  }
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
  const ctx = fsm.getContext();
  const yearStart = `${ctx.viewYear}-01-01`;
  const yearEndCap = `${ctx.viewYear}-12-31`;
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
    el.innerHTML = `<span class="ys-label">${t('calendar.jump_year', { year: ctx.viewYear })}</span><span class="ys-nums">${escapeHtml(t('year_summary.empty'))}</span>`;
    return;
  }
  const numsHtml = currencies.map(cur => {
    const d = byCurrency[cur];
    return `${fromScaled(d.total)}${escapeHtml(cur)}<span class="count">${t('year_summary.count_format', { count: d.count })}</span>`;
  }).join('　');
  el.innerHTML = `<span class="ys-label">${escapeHtml(t('year_summary.title', { year: ctx.viewYear }))}</span><span class="ys-nums">${numsHtml}</span>`;
}

/* ============ カラーピッカー ============ */
function setupColorPicker() {
  const container = document.getElementById('colorPicker');
  const customColorInput = document.getElementById('customColor');
  if (!container) return;

  customColors = getCustomColors();
  const allColors = [...DEFAULT_COLORS, ...customColors];
  const ctx = fsm.getContext();
  const isDeleteMode = fsm.getState() === STATES.COLOR_DELETE;

  container.innerHTML = '';
  allColors.forEach(color => {
    const isCustom = !DEFAULT_COLORS.includes(color);
    const isMarked = ctx.colorsMarkedForDelete.has(color);
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.backgroundColor = color;
    if (color === selectedColor && !isDeleteMode) dot.classList.add('selected');

    if (isDeleteMode && isCustom) {
      dot.style.outline = isMarked ? '2px solid var(--stamp-red)' : '1px dashed var(--ink-faint)';
      dot.addEventListener('click', () => {
        if (ctx.colorsMarkedForDelete.has(color)) {
          ctx.colorsMarkedForDelete.delete(color);
        } else {
          ctx.colorsMarkedForDelete.add(color);
        }
        setupColorPicker();
      });
    } else {
      dot.addEventListener('click', () => {
        selectedColor = color;
        setupColorPicker();
      });
    }
    container.appendChild(dot);
  });

  if (!isDeleteMode) {
    if (customColors.length < MAX_CUSTOM_COLORS) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'color-action-btn';
      addBtn.title = t('form.tooltip_color_add');
      addBtn.innerHTML = '<svg class="icon-sm"><use href="#icon-plus"/></svg>';
      addBtn.addEventListener('click', () => customColorInput?.click());
      container.appendChild(addBtn);
    }
    if (customColors.length > 0) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'color-action-btn';
      editBtn.title = t('form.tooltip_color_edit');
      editBtn.innerHTML = '<svg class="icon-sm"><use href="#icon-trash-2"/></svg>';
      editBtn.addEventListener('click', () => fsm.dispatch(EVENTS.ENTER_COLOR_DELETE));
      container.appendChild(editBtn);
    }
  } else {
    const delConfirmBtn = document.createElement('button');
    delConfirmBtn.type = 'button';
    delConfirmBtn.className = 'btn-primary';
    delConfirmBtn.style.padding = '4px 10px';
    delConfirmBtn.style.fontSize = '11px';
    delConfirmBtn.textContent = `${t('form.btn_color_delete')} (${ctx.colorsMarkedForDelete.size})`;
    delConfirmBtn.addEventListener('click', () => {
      customColors = customColors.filter(c => !ctx.colorsMarkedForDelete.has(c));
      saveCustomColors(customColors);
      if (ctx.colorsMarkedForDelete.has(selectedColor)) selectedColor = DEFAULT_COLORS[0];
      fsm.dispatch(EVENTS.EXIT_COLOR_DELETE);
      setupColorPicker();
    });
    container.appendChild(delConfirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.padding = '4px 10px';
    cancelBtn.style.fontSize = '11px';
    cancelBtn.textContent = t('form.btn_cancel');
    cancelBtn.addEventListener('click', () => {
      fsm.dispatch(EVENTS.EXIT_COLOR_DELETE);
      setupColorPicker();
    });
    container.appendChild(cancelBtn);
  }

  if (customColorInput) {
    customColorInput.onchange = (e) => {
      const newCol = e.target.value;
      if (newCol && !allColors.includes(newCol)) {
        customColors.push(newCol);
        saveCustomColors(customColors);
        selectedColor = newCol;
        setupColorPicker();
      }
    };
  }
}

/* ============ フォーム制御 ============ */
function openForm(scenarioId = null) {
  const formCard = document.getElementById('formCard');
  const title = document.getElementById('formTitle');
  const saveBtn = document.getElementById('saveBtn');
  if (!formCard) return;

  formCard.classList.add('open');
  const ctx = fsm.getContext();

  if (scenarioId) {
    const s = scenarios.find(sc => sc.id === scenarioId);
    if (!s) return;
    if (title) title.textContent = t('form.title_edit');
    if (saveBtn) saveBtn.textContent = t('form.btn_save_edit');

    document.getElementById('fName').value = s.name || '';
    document.getElementById('fStart').value = s.start || '';
    document.getElementById('fEnd').value = s.end || '';
    document.getElementById('fAmount').value = fromScaled(s.amountScaled);
    document.getElementById('fTargetAmount').value = s.targetAmountScaled ? fromScaled(s.targetAmountScaled) : '';
    document.getElementById('fCurrency').value = s.currency || t('form.default_currency');
    document.getElementById('fIntervalType').value = s.intervalType || 'days';
    document.getElementById('fInterval').value = s.interval || 1;
    document.getElementById('fMonthDay').value = s.monthDay || 1;
    selectedColor = s.color || DEFAULT_COLORS[0];
  } else {
    if (title) title.textContent = t('form.title_new');
    if (saveBtn) saveBtn.textContent = t('form.btn_save_new');

    document.getElementById('fName').value = '';
    document.getElementById('fStart').value = todayStr();
    document.getElementById('fEnd').value = '';
    document.getElementById('fAmount').value = '';
    document.getElementById('fTargetAmount').value = '';
    document.getElementById('fCurrency').value = t('form.default_currency');
    document.getElementById('fIntervalType').value = 'days';
    document.getElementById('fInterval').value = 1;
    document.getElementById('fMonthDay').value = 1;
    selectedColor = DEFAULT_COLORS[0];
  }

  updateIntervalFormVisibility();
  setupColorPicker();
  formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  const formCard = document.getElementById('formCard');
  if (formCard) formCard.classList.remove('open');
}

function updateIntervalFormVisibility() {
  const type = document.getElementById('fIntervalType')?.value;
  const daysRow = document.getElementById('daysIntervalRow');
  const monthRow = document.getElementById('monthlyDateRow');
  if (daysRow) daysRow.style.display = (type === 'days') ? 'block' : 'none';
  if (monthRow) monthRow.style.display = (type === 'monthlyDate') ? 'block' : 'none';
}

/* ============ 目標期日逆算シミュレーター ============ */
function setupSimulator() {
  const modal = document.getElementById('simulatorModal');
  const openBtn = document.getElementById('simulatorBtn');
  const closeBtn = document.getElementById('simCloseBtn');
  const calcBtn = document.getElementById('simCalcBtn');
  const targetDateInput = document.getElementById('simTargetDate');
  const targetAmountInput = document.getElementById('simTargetAmount');
  const resultCard = document.getElementById('simResult');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      fsm.dispatch(EVENTS.OPEN_SIMULATOR);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      fsm.dispatch(EVENTS.CLOSE_SIMULATOR);
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fsm.dispatch(EVENTS.CLOSE_SIMULATOR);
    });
  }

  if (calcBtn && targetDateInput && targetAmountInput && resultCard) {
    calcBtn.addEventListener('click', () => {
      const deadline = targetDateInput.value;
      const targetScaled = toScaled(targetAmountInput.value);

      if (!deadline || !targetScaled || targetScaled <= 0n) {
        alert(t('simulator.alert_invalid_params'));
        return;
      }

      if (scenarios.length === 0) {
        alert(t('export.alert_empty'));
        return;
      }

      // 最初のシナリオまたは合算シミュレーション
      const targetScenario = scenarios[0];
      const res = calculateRequiredAmountPerDeposit(targetScenario, targetScaled, deadline);

      resultCard.style.display = 'block';
      if (res.alreadyReached) {
        resultCard.innerHTML = `
          <div class="sim-result-item" style="color:var(--stamp-green)">
            ${t('simulator.result_already_reached', { target: fromScaled(targetScaled), currency: targetScenario.currency })}
          </div>
        `;
      } else if (res.noDeposits) {
        resultCard.innerHTML = `
          <div class="sim-result-item" style="color:var(--stamp-red)">
            ${t('simulator.result_no_deposits')}
          </div>
        `;
      } else {
        resultCard.innerHTML = `
          <div class="sim-result-item">
            <span>${t('simulator.result_title')}</span>
            <span class="num">${fromScaled(res.requiredPerDepositScaled)} ${targetScenario.currency}</span>
          </div>
          <div class="sim-result-item">
            <span>${t('simulator.result_deposits_left', { count: res.remainingDeposits })}</span>
          </div>
          <div class="sim-result-item" style="font-size:11.5px;color:var(--ink-soft)">
            ${t('simulator.result_current_projected', { projected: fromScaled(res.projectedTotalScaled), currency: targetScenario.currency })}
          </div>
        `;
      }
    });
  }
}

/* ============ 全体描画 ============ */
function renderAll() {
  const ctx = fsm.getContext();
  renderGrandTotal();
  renderLedgerList();
  renderYearSummary();
  if (ctx.isYearView) {
    renderYearGrid();
  } else {
    renderCalendar();
  }
  renderDayDetail();
  renderChart(scenarios, ctx.chartPeriod, ctx.chartType);
}

/* ============ 通知機能 ============ */
async function toggleNotify() {
  const btn = document.getElementById('notifyBtn');
  const stateText = document.getElementById('notifyState');
  if (!notifyEnabled) {
    if (!('Notification' in window)) {
      alert(t('notify.alert_unsupported'));
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert(t('notify.alert_denied'));
      return;
    }
    notifyEnabled = true;
    if (btn) btn.classList.add('active');
    if (stateText) stateText.textContent = t('tools.notify_on');
    checkAndNotify();
    notifyTimer = setInterval(checkAndNotify, 60000);
  } else {
    notifyEnabled = false;
    if (btn) btn.classList.remove('active');
    if (stateText) stateText.textContent = t('tools.notify_off');
    if (notifyTimer) clearInterval(notifyTimer);
  }
}

function checkAndNotify() {
  if (!notifyEnabled) return;
  const today = todayStr();
  if (notifiedToday.date !== today) {
    notifiedToday = { date: today, ids: [] };
  }
  scenarios.forEach(s => {
    if (isDepositDay(s, today) && !notifiedToday.ids.includes(s.id)) {
      notifiedToday.ids.push(s.id);
      new Notification(t('app.title'), {
        body: t('notify.body', { name: s.name || t('ledger.untitled') }),
        icon: 'screenshot.png'
      });
    }
  });
}

/* ============ Pointer Events: PCドラッグ & スマホスワイプ ============ */
function setupPointerSwipe() {
  const wrapper = document.getElementById('calWrapper');
  if (!wrapper) return;

  wrapper.addEventListener('pointerdown', (e) => {
    // ボタンやセルクリックとの干渉防止
    if (e.target.closest('button') || e.target.closest('.cal-cell')) return;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    isPointerDragging = true;
    pointerDeltaX = 0;
    wrapper.classList.add('dragging');
    wrapper.setPointerCapture(e.pointerId);
  });

  wrapper.addEventListener('pointermove', (e) => {
    if (!isPointerDragging) return;
    pointerDeltaX = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    // 縦スクロールと横スワイプの優先判定
    if (Math.abs(pointerDeltaX) > Math.abs(dy)) {
      wrapper.style.transform = `translateX(${pointerDeltaX * 0.4}px)`;
    }
  });

  const endDrag = (e) => {
    if (!isPointerDragging) return;
    isPointerDragging = false;
    wrapper.classList.remove('dragging');
    wrapper.style.transform = '';
    try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}

    // スワイプ距離閾値（50px）
    if (pointerDeltaX > 50) {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: -1 });
    } else if (pointerDeltaX < -50) {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: 1 });
    }
  };

  wrapper.addEventListener('pointerup', endDrag);
  wrapper.addEventListener('pointercancel', endDrag);
}

/* ============ キーボードナビゲーション ============ */
function setupKeyboardNav() {
  window.addEventListener('keydown', (e) => {
    // フォーム入力中はスキップ
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'ArrowLeft') {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: -1 });
    } else if (e.key === 'ArrowRight') {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: 1 });
    } else if (e.key === 'Home') {
      fsm.dispatch(EVENTS.GO_TO_TODAY);
    }
  });
}

/* ============ イベント初期設定 ============ */
function setupEvents() {
  // FSM サブスクライブ
  fsm.subscribe((state, ctx, event) => {
    const formCard = document.getElementById('formCard');
    const simModal = document.getElementById('simulatorModal');
    const calGrid = document.getElementById('calGrid');
    const yearGrid = document.getElementById('yearGrid');
    const yearViewBtn = document.getElementById('yearViewBtn');

    if (state === STATES.SCENARIO_FORM) {
      openForm(ctx.editingScenarioId);
    } else if (state !== STATES.COLOR_DELETE) {
      closeForm();
    }

    if (state === STATES.SIMULATOR) {
      if (simModal) simModal.style.display = 'flex';
    } else {
      if (simModal) simModal.style.display = 'none';
    }

    if (yearViewBtn) yearViewBtn.classList.toggle('active', ctx.isYearView);
    if (calGrid) calGrid.style.display = ctx.isYearView ? 'none' : 'grid';
    if (yearGrid) yearGrid.style.display = ctx.isYearView ? 'grid' : 'none';

    renderAll();
  });

  // フォーム開閉トグル
  document.getElementById('addToggle')?.addEventListener('click', () => {
    fsm.dispatch(EVENTS.OPEN_CREATE_FORM);
  });
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    fsm.dispatch(EVENTS.CLOSE_FORM);
  });

  // 間隔タイプ変更
  document.getElementById('fIntervalType')?.addEventListener('change', updateIntervalFormVisibility);

  // 日付ショートカット
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const day = e.target.dataset.day;
      const input = document.getElementById('fMonthDay');
      if (input) input.value = day;
    });
  });

  // フォーム保存
  document.getElementById('saveBtn')?.addEventListener('click', () => {
    const name = document.getElementById('fName').value.trim();
    const start = document.getElementById('fStart').value;
    const end = document.getElementById('fEnd').value || null;
    const amountScaled = toScaled(document.getElementById('fAmount').value);
    const targetAmountScaled = toScaled(document.getElementById('fTargetAmount').value);
    const currency = document.getElementById('fCurrency').value.trim() || t('form.default_currency');
    const intervalType = document.getElementById('fIntervalType').value;
    const interval = parseInt(document.getElementById('fInterval').value, 10);
    const monthDay = parseInt(document.getElementById('fMonthDay').value, 10);

    if (!start || amountScaled === null || amountScaled <= 0n) {
      alert(t('form.alert_invalid_input'));
      return;
    }
    if (end && end < start) {
      alert(t('form.alert_invalid_end_date'));
      return;
    }
    if (intervalType === 'days' && (isNaN(interval) || interval < 1)) {
      alert(t('form.alert_invalid_interval'));
      return;
    }

    const ctx = fsm.getContext();
    if (ctx.editingScenarioId) {
      const s = scenarios.find(sc => sc.id === ctx.editingScenarioId);
      if (s) {
        Object.assign(s, {
          name, start, end,
          amountScaled: amountScaled.toString(),
          targetAmountScaled: targetAmountScaled ? targetAmountScaled.toString() : null,
          currency, intervalType, interval, monthDay,
          color: selectedColor
        });
      }
    } else {
      scenarios.push({
        id: genId(),
        name, start, end,
        amountScaled: amountScaled.toString(),
        targetAmountScaled: targetAmountScaled ? targetAmountScaled.toString() : null,
        currency, intervalType, interval, monthDay,
        color: selectedColor,
        interrupts: []
      });
    }

    storageSet(scenarios);
    setupJumpSelects();
    fsm.dispatch(EVENTS.CLOSE_FORM);
  });

  // 割り込み追加
  document.getElementById('interruptAdd')?.addEventListener('click', () => {
    const ctx = fsm.getContext();
    if (!ctx.selectedDateStr) return;
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
      date: ctx.selectedDateStr,
      amountScaled: amountScaled.toString()
    });
    storageSet(scenarios);
    document.getElementById('interruptAmount').value = '';
    renderAll();
  });

  // ツールボタン
  document.getElementById('notifyBtn')?.addEventListener('click', toggleNotify);
  document.getElementById('exportBtn')?.addEventListener('click', () => exportCsv(scenarios));
  document.getElementById('exportJsonBtn')?.addEventListener('click', () => exportJson(scenarios));
  document.getElementById('importBtn')?.addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile')?.addEventListener('change', (e) => {
    importJson(e.target.files[0], scenarios, (updated) => {
      scenarios = updated;
      storageSet(scenarios);
      setupJumpSelects();
      renderAll();
    });
    e.target.value = '';
  });

  // カレンダー操作
  document.getElementById('todayBtn')?.addEventListener('click', () => {
    fsm.dispatch(EVENTS.GO_TO_TODAY);
  });

  document.getElementById('yearViewBtn')?.addEventListener('click', () => {
    fsm.dispatch(EVENTS.TOGGLE_YEAR_VIEW);
  });

  document.getElementById('prevMonth')?.addEventListener('click', () => {
    const ctx = fsm.getContext();
    if (ctx.isYearView) {
      fsm.dispatch(EVENTS.SET_VIEW_YEAR, { year: ctx.viewYear - 1 });
    } else {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: -1 });
    }
  });

  document.getElementById('nextMonth')?.addEventListener('click', () => {
    const ctx = fsm.getContext();
    if (ctx.isYearView) {
      fsm.dispatch(EVENTS.SET_VIEW_YEAR, { year: ctx.viewYear + 1 });
    } else {
      fsm.dispatch(EVENTS.NAVIGATE_MONTH, { delta: 1 });
    }
  });

  // チャート期間フィルター & タイプ切り替え
  document.querySelectorAll('.chart-period-group .chart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chart-period-group .chart-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      fsm.dispatch(EVENTS.SET_CHART_PERIOD, { period: e.currentTarget.dataset.period });
    });
  });

  document.querySelectorAll('.chart-type-group .chart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chart-type-group .chart-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      fsm.dispatch(EVENTS.SET_CHART_TYPE, { type: e.currentTarget.dataset.type });
    });
  });

  setupLedgerListEvents();
  setupPointerSwipe();
  setupKeyboardNav();
  setupSimulator();
}

/**
 * シナリオ一覧のイベント委譲
 */
function setupLedgerListEvents() {
  const list = document.getElementById('ledgerList');
  if (!list) return;

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    // 上へ移動
    if (btn.classList.contains('ledger-move-up')) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (idx > 0) {
        const item = scenarios.splice(idx, 1)[0];
        scenarios.splice(idx - 1, 0, item);
        storageSet(scenarios);
        renderAll();
      }
      return;
    }

    // 下へ移動
    if (btn.classList.contains('ledger-move-down')) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (idx < scenarios.length - 1) {
        const item = scenarios.splice(idx, 1)[0];
        scenarios.splice(idx + 1, 0, item);
        storageSet(scenarios);
        renderAll();
      }
      return;
    }

    // 複製
    if (btn.classList.contains('ledger-copy')) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const target = scenarios.find(s => s.id === id);
      if (!target) return;

      const duplicated = {
        ...JSON.parse(JSON.stringify(target)),
        id: genId(),
        name: (target.name ? target.name : t('ledger.untitled')) + t('form.copy_suffix')
      };
      scenarios.push(duplicated);
      storageSet(scenarios);
      renderAll();
      return;
    }

    // 削除
    if (btn.classList.contains('ledger-del')) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm(t('ledger.confirm_delete'))) return;
      scenarios = scenarios.filter(s => s.id !== id);
      storageSet(scenarios);
      renderAll();
      return;
    }

    // 編集
    if (btn.classList.contains('ledger-edit')) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      fsm.dispatch(EVENTS.OPEN_EDIT_FORM, { scenarioId: id });
      return;
    }

    // 共有
    if (btn.classList.contains('ledger-share')) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const target = scenarios.find(s => s.id === id);
      if (target) shareScenarioUrl(target);
      return;
    }

    // 割り込み個別削除
    if (btn.classList.contains('ledger-iv-del')) {
      e.preventDefault();
      e.stopPropagation();
      const sid = btn.dataset.sid;
      const ivid = btn.dataset.ivid;
      const s = scenarios.find(sc => sc.id === sid);
      if (s) {
        s.interrupts = (s.interrupts || []).filter(iv => iv.id !== ivid);
        storageSet(scenarios);
        renderAll();
      }
      return;
    }
  });
}

/* ============ アプリ初期化 ============ */
async function init() {
  await initI18n();

  const canvas = document.getElementById('chartCanvas');
  const container = document.getElementById('chartContainer');
  if (canvas && container) {
    initChart(canvas, container);
  }

  scenarios = storageGet();
  setupColorPicker();
  setupJumpSelects();
  setupEvents();
  renderAll();

  await checkShareParam(async (newScenario) => {
    scenarios.push(newScenario);
    storageSet(scenarios);
    setupJumpSelects();
    renderAll();
  });

  // PWA Service Worker登録
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      console.debug('[PWA] Service Worker registered.');
    } catch (err) {
      console.debug('[PWA] Service Worker registration failed:', err);
    }
  }
}

init();
