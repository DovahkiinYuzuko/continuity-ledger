import { fromScaled, totalAt, todayStr } from './math.js';
import { t, formatDateLocale } from './i18n.js';

let chartCanvas = null;
let chartCtx = null;
let chartContainer = null;
let activeScenarios = [];
let hoverDateIndex = -1;
let sampleCount = 0;

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
    renderChart(activeScenarios);
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
 */
export function renderChart(scenarios) {
  activeScenarios = scenarios || [];
  if (!chartCanvas || !chartCtx || !chartContainer) return;

  const rect = chartContainer.getBoundingClientRect();
  const width = Math.floor(rect.width);
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

  // 1. 全シナリオの開始日の中で最古の日付を取得
  const startDates = activeScenarios.map(s => s.start).sort();
  const earliestStart = startDates[0];
  const today = todayStr();

  // 開始日から今日（＋少し先の未来、例えば30日後）までの日付サンプリング点を生成
  const startD = new Date(earliestStart + 'T00:00:00');
  const todayD = new Date(today + 'T00:00:00');
  
  // 開始から今日までの日数
  const totalDays = Math.max(1, Math.floor((todayD - startD) / 86400000));
  
  // 最大サンプル数を100点程度に間引いて計算負荷を最適化
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
  sampleCount = sampleDates.length;

  // 各サンプル日における各シナリオの累計金額を計算
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
  seriesData.forEach(ser => {
    ser.points.forEach(pt => {
      if (pt.value > maxValue) maxValue = pt.value;
    });
  });
  if (maxValue === 0) maxValue = 100;

  // 余白設定
  const padding = { top: 20, right: 30, bottom: 40, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // 2. Y軸グリッド線とラベル
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

  // 3. X軸ラベル（最初、中間、今日）
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

  // 4. 各シナリオの折れ線・塗りつぶし描画
  seriesData.forEach(ser => {
    const color = ser.scenario.color || '#a4402f';

    // 塗りつぶしグラデーション（8桁HEXによるアルファ指定）
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

    // 塗りつぶしパスを閉じる
    chartCtx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
    chartCtx.lineTo(padding.left, padding.top + plotHeight);
    chartCtx.closePath();
    chartCtx.fillStyle = grad;
    chartCtx.fill();

    // 境界線描画
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

  // 5. ホバー時の縦線＆ツールチップ描画
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

    // 各系列のホバー位置にポイントを描画
    seriesData.forEach(ser => {
      const pt = ser.points[hoverDateIndex];
      const y = padding.top + plotHeight - (plotHeight * (pt.value / maxValue));
      chartCtx.fillStyle = ser.scenario.color || '#a4402f';
      chartCtx.beginPath();
      chartCtx.arc(hoverX, y, 4, 0, Math.PI * 2);
      chartCtx.fill();
      chartCtx.strokeStyle = '#fff';
      chartCtx.lineWidth = 1.5;
      chartCtx.stroke();
    });

    renderTooltip(hoverX, padding.top, hoverDateStr, seriesData, hoverDateIndex, width);
  }
}

function handleMouseMove(e) {
  if (activeScenarios.length === 0) return;
  const rect = chartCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  updateHoverFromX(x, rect.width);
}

function handleTouchMove(e) {
  if (activeScenarios.length === 0 || !e.touches[0]) return;
  const rect = chartCanvas.getBoundingClientRect();
  const x = e.touches[0].clientX - rect.left;
  updateHoverFromX(x, rect.width);
}

function updateHoverFromX(x, width) {
  const padding = { left: 60, right: 30 };
  const plotWidth = width - padding.left - padding.right;
  if (x < padding.left || x > width - padding.right) {
    hoverDateIndex = -1;
    renderChart(activeScenarios);
    return;
  }
  const ratio = Math.max(0, Math.min(1, (x - padding.left) / plotWidth));
  const maxIdx = Math.max(1, sampleCount - 1);
  hoverDateIndex = Math.round(ratio * maxIdx);
  renderChart(activeScenarios);
}

function handleMouseLeave() {
  if (hoverDateIndex !== -1) {
    hoverDateIndex = -1;
    renderChart(activeScenarios);
  }
}

function renderTooltip(x, yTop, dateStr, seriesData, sampleIdx, canvasWidth) {
  const lines = [formatDateLocale(dateStr)];
  seriesData.forEach(ser => {
    const pt = ser.points[sampleIdx];
    const name = ser.scenario.name || t('ledger.untitled');
    const amt = fromScaled(pt.totalBigInt);
    lines.push(`${name}: ${amt}${ser.scenario.currency || ''}`);
  });

  chartCtx.font = '11px "Zen Kaku Gothic New", sans-serif';
  let maxTextW = 0;
  lines.forEach(l => {
    const w = chartCtx.measureText(l).width;
    if (w > maxTextW) maxTextW = w;
  });

  const boxW = maxTextW + 16;
  const boxH = lines.length * 16 + 10;
  let boxX = x + 10;
  if (boxX + boxW > canvasWidth - 10) {
    boxX = x - boxW - 10;
  }
  const boxY = yTop + 10;

  // ツールチップ背景
  chartCtx.fillStyle = 'rgba(25, 23, 20, 0.9)';
  chartCtx.beginPath();
  chartCtx.roundRect(boxX, boxY, boxW, boxH, 6);
  chartCtx.fill();

  // ツールチップテキスト
  chartCtx.textAlign = 'left';
  chartCtx.textBaseline = 'top';
  lines.forEach((l, idx) => {
    chartCtx.fillStyle = idx === 0 ? '#d5cec2' : '#ffffff';
    chartCtx.fillText(l, boxX + 8, boxY + 6 + idx * 16);
  });
}
