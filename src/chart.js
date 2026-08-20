import { fromScaled, totalAt, todayStr } from './math.js';
import { t, formatDateLocale } from './i18n.js';

let chartCanvas = null;
let chartCtx = null;
let chartContainer = null;
let activeScenarios = [];
let hoverDateIndex = -1;
let currentPeriod = 'all'; // '1y' | '3y' | '5y' | 'all'
let currentChartType = 'line'; // 'line' | 'stack'

/**
 * チャートの初期化
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 */
export function initChart(canvas, container) {
  chartCanvas = canvas;
  chartContainer = container;
  chartCtx = canvas.getContext('2d');

  // リサイズ監視
  const resizeObserver = new ResizeObserver(() => {
    renderChart(activeScenarios, currentPeriod, currentChartType);
  });
  resizeObserver.observe(container);

  // ホバーインタラクション
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
  canvas.addEventListener('touchend', handleMouseLeave);
}

/**
 * チャートを再描画
 * @param {Array} scenarios
 * @param {string} [period='all']
 * @param {string} [chartType='line']
 */
export function renderChart(scenarios, period = currentPeriod, chartType = currentChartType) {
  activeScenarios = scenarios || [];
  currentPeriod = period;
  currentChartType = chartType;

  if (!chartCanvas || !chartCtx || !chartContainer) return;

  const rect = chartContainer.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width));
  const height = 260; // グラフの高さ

  const dpr = window.devicePixelRatio || 1;
  chartCanvas.width = width * dpr;
  chartCanvas.height = height * dpr;
  chartCanvas.style.width = `${width}px`;
  chartCanvas.style.height = `${height}px`;

  chartCtx.resetTransform();
  chartCtx.scale(dpr, dpr);
  chartCtx.clearRect(0, 0, width, height);

  if (activeScenarios.length === 0) {
    chartCtx.fillStyle = 'var(--text-muted, #7c7468)';
    chartCtx.font = '13px "Zen Kaku Gothic New", sans-serif';
    chartCtx.textAlign = 'center';
    chartCtx.textBaseline = 'middle';
    chartCtx.fillText(t('chart.empty'), width / 2, height / 2);
    return;
  }

  // 1. サンプリング期間の決定
  const startDates = activeScenarios.map(s => s.start).sort();
  let earliestStart = startDates[0];
  const today = todayStr();
  const todayD = new Date(today + 'T00:00:00');

  if (period !== 'all') {
    const yearsBack = period === '1y' ? 1 : period === '3y' ? 3 : 5;
    const filterStartD = new Date(todayD);
    filterStartD.setFullYear(filterStartD.getFullYear() - yearsBack);
    const filterStartStr = `${filterStartD.getFullYear()}-${String(filterStartD.getMonth() + 1).padStart(2, '0')}-${String(filterStartD.getDate()).padStart(2, '0')}`;
    if (filterStartStr > earliestStart) {
      earliestStart = filterStartStr;
    }
  }

  const startD = new Date(earliestStart + 'T00:00:00');
  const totalDays = Math.max(1, Math.floor((todayD - startD) / 86400000));
  const stepDays = Math.max(1, Math.floor(totalDays / 80));
  const sampleDates = [];
  let curr = new Date(startD);
  while (curr <= todayD) {
    const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
    sampleDates.push(dStr);
    curr.setDate(curr.getDate() + stepDays);
  }
  if (!sampleDates.includes(today)) {
    sampleDates.push(today);
  }

  // 2. 各サンプリング日のシナリオ別金額計算
  const seriesData = activeScenarios.map(s => {
    const points = sampleDates.map(dateStr => {
      const { total } = totalAt(s, dateStr);
      return {
        date: dateStr,
        totalBigInt: total,
        value: Number(total) / 1e6
      };
    });
    return { scenario: s, points };
  });

  // 最大値の算出
  let maxValue = 0;
  if (chartType === 'stack') {
    for (let i = 0; i < sampleDates.length; i++) {
      let sumAtI = 0;
      seriesData.forEach(ser => {
        sumAtI += ser.points[i].value;
      });
      if (sumAtI > maxValue) maxValue = sumAtI;
    }
  } else {
    seriesData.forEach(ser => {
      ser.points.forEach(pt => {
        if (pt.value > maxValue) maxValue = pt.value;
      });
    });
  }
  if (maxValue === 0) maxValue = 100;

  const padding = { top: 20, right: 30, bottom: 40, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // 3. Y軸グリッド線とラベル
  chartCtx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  chartCtx.lineWidth = 1;
  chartCtx.fillStyle = '#7c7468';
  chartCtx.font = '11px "Zen Kaku Gothic New", sans-serif';
  chartCtx.textAlign = 'right';
  chartCtx.textBaseline = 'middle';

  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const yVal = (maxValue / yTicks) * i;
    const y = padding.top + plotHeight - (plotHeight * (i / yTicks));
    
    chartCtx.beginPath();
    chartCtx.moveTo(padding.left, y);
    chartCtx.lineTo(width - padding.right, y);
    chartCtx.stroke();

    const formatted = yVal >= 10000 ? `${(yVal / 10000).toFixed(1)}万` : Math.round(yVal).toLocaleString();
    chartCtx.fillText(formatted, padding.left - 8, y);
  }

  // 4. X軸ラベル
  chartCtx.textAlign = 'center';
  chartCtx.textBaseline = 'top';
  const xLabels = [
    { index: 0, text: formatDateLocale(sampleDates[0]) },
    { index: Math.floor(sampleDates.length / 2), text: formatDateLocale(sampleDates[Math.floor(sampleDates.length / 2)]) },
    { index: sampleDates.length - 1, text: formatDateLocale(sampleDates[sampleDates.length - 1]) }
  ];

  xLabels.forEach(lbl => {
    const x = padding.left + (plotWidth * (lbl.index / (sampleDates.length - 1)));
    chartCtx.fillText(lbl.text, x, padding.top + plotHeight + 10);
  });

  // 5. チャート描画（折れ線 または 積み上げ面）
  if (chartType === 'stack') {
    // 積み上げ面グラフ描画
    let prevCumulative = new Array(sampleDates.length).fill(0);

    seriesData.forEach(ser => {
      const color = ser.scenario.color || '#a4402f';
      const currCumulative = prevCumulative.map((prev, idx) => prev + ser.points[idx].value);

      // 上限パス
      chartCtx.beginPath();
      for (let i = 0; i < sampleDates.length; i++) {
        const x = padding.left + (plotWidth * (i / (sampleDates.length - 1)));
        const y = padding.top + plotHeight - (plotHeight * (currCumulative[i] / maxValue));
        if (i === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      }

      // 下限（前の層）パスを逆順でつなぐ
      for (let i = sampleDates.length - 1; i >= 0; i--) {
        const x = padding.left + (plotWidth * (i / (sampleDates.length - 1)));
        const y = padding.top + plotHeight - (plotHeight * (prevCumulative[i] / maxValue));
        chartCtx.lineTo(x, y);
      }
      chartCtx.closePath();

      chartCtx.fillStyle = `${color}40`;
      chartCtx.fill();

      // 上辺の境界線
      chartCtx.beginPath();
      for (let i = 0; i < sampleDates.length; i++) {
        const x = padding.left + (plotWidth * (i / (sampleDates.length - 1)));
        const y = padding.top + plotHeight - (plotHeight * (currCumulative[i] / maxValue));
        if (i === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      }
      chartCtx.strokeStyle = color;
      chartCtx.lineWidth = 1.5;
      chartCtx.stroke();

      prevCumulative = currCumulative;
    });
  } else {
    // 通常の折れ線・塗りつぶし描画
    seriesData.forEach(ser => {
      const color = ser.scenario.color || '#a4402f';

      const grad = chartCtx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
      grad.addColorStop(0, `${color}33`);
      grad.addColorStop(1, `${color}05`);

      chartCtx.beginPath();
      ser.points.forEach((pt, idx) => {
        const x = padding.left + (plotWidth * (idx / (sampleDates.length - 1)));
        const y = padding.top + plotHeight - (plotHeight * (pt.value / maxValue));
        if (idx === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      chartCtx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
      chartCtx.lineTo(padding.left, padding.top + plotHeight);
      chartCtx.closePath();
      chartCtx.fillStyle = grad;
      chartCtx.fill();

      chartCtx.beginPath();
      ser.points.forEach((pt, idx) => {
        const x = padding.left + (plotWidth * (idx / (sampleDates.length - 1)));
        const y = padding.top + plotHeight - (plotHeight * (pt.value / maxValue));
        if (idx === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      chartCtx.strokeStyle = color;
      chartCtx.lineWidth = 2;
      chartCtx.stroke();
    });
  }

  // 6. ホバー時の縦線＆ツールチップ描画
  if (hoverDateIndex >= 0 && hoverDateIndex < sampleDates.length) {
    const hoverX = padding.left + (plotWidth * (hoverDateIndex / (sampleDates.length - 1)));
    const hoverDateStr = sampleDates[hoverDateIndex];

    chartCtx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    chartCtx.setLineDash([4, 4]);
    chartCtx.beginPath();
    chartCtx.moveTo(hoverX, padding.top);
    chartCtx.lineTo(hoverX, padding.top + plotHeight);
    chartCtx.stroke();
    chartCtx.setLineDash([]);

    // ツールチップボックス
    const tipLines = [
      formatDateLocale(hoverDateStr)
    ];

    let grandTotalAtHover = 0n;
    seriesData.forEach(ser => {
      const pt = ser.points[hoverDateIndex];
      tipLines.push(`${ser.scenario.name || t('ledger.untitled')}: ${fromScaled(pt.totalBigInt)}${ser.scenario.currency || ''}`);
      grandTotalAtHover += pt.totalBigInt;
    });

    if (seriesData.length > 1) {
      tipLines.push(t('chart.tooltip_total', {
        total: fromScaled(grandTotalAtHover),
        currency: seriesData[0].scenario.currency || ''
      }));
    }

    chartCtx.font = '12px "Zen Kaku Gothic New", sans-serif';
    let maxTextW = 0;
    tipLines.forEach(l => {
      const w = chartCtx.measureText(l).width;
      if (w > maxTextW) maxTextW = w;
    });

    const boxW = maxTextW + 16;
    const boxH = tipLines.length * 18 + 12;
    let boxX = hoverX + 10;
    if (boxX + boxW > width - 10) boxX = hoverX - boxW - 10;
    let boxY = padding.top + 10;

    chartCtx.fillStyle = 'rgba(30, 26, 20, 0.88)';
    chartCtx.beginPath();
    chartCtx.roundRect(boxX, boxY, boxW, boxH, 6);
    chartCtx.fill();

    chartCtx.fillStyle = '#ffffff';
    chartCtx.textAlign = 'left';
    chartCtx.textBaseline = 'top';
    tipLines.forEach((l, idx) => {
      chartCtx.fillText(l, boxX + 8, boxY + 6 + (idx * 18));
    });
  }
}

function handleMouseMove(e) {
  if (!chartCanvas || activeScenarios.length === 0) return;
  const rect = chartCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  updateHover(mouseX, rect.width);
}

function handleTouchMove(e) {
  if (!chartCanvas || activeScenarios.length === 0 || !e.touches[0]) return;
  const rect = chartCanvas.getBoundingClientRect();
  const touchX = e.touches[0].clientX - rect.left;
  updateHover(touchX, rect.width);
}

function updateHover(x, width) {
  const padding = { left: 60, right: 30 };
  const plotWidth = width - padding.left - padding.right;
  if (x < padding.left || x > width - padding.right) {
    hoverDateIndex = -1;
  } else {
    const ratio = (x - padding.left) / plotWidth;
    hoverDateIndex = Math.round(ratio * 80);
  }
  renderChart(activeScenarios, currentPeriod, currentChartType);
}

function handleMouseLeave() {
  hoverDateIndex = -1;
  renderChart(activeScenarios, currentPeriod, currentChartType);
}
