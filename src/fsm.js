/**
 * @file fsm.js
 * @description 積んでたら台帳 本格的有限状態機械 (Finite State Machine / State Machine)
 * 画面状態の一元管理、イベント駆動遷移、ガード、およびサブスクライバを提供。
 */

export const STATES = {
  CALENDAR_MONTH: 'CALENDAR_MONTH', // カレンダー月表示（デフォルト）
  CALENDAR_YEAR: 'CALENDAR_YEAR',   // 年間12ヶ月グリッド表示
  LEDGER_DRAWER: 'LEDGER_DRAWER',   // 台帳一覧ドロワー/モーダル表示
  SCENARIO_FORM: 'SCENARIO_FORM',   // シナリオ新規作成/編集モーダル
  SIMULATOR: 'SIMULATOR',           // 目標期日逆算シミュレーター
  COLOR_DELETE: 'COLOR_DELETE'      // カラータグ削除モード
};

export const EVENTS = {
  // ナビゲーション
  NAVIGATE_MONTH: 'NAVIGATE_MONTH',
  SET_VIEW_YEAR: 'SET_VIEW_YEAR',
  SET_VIEW_MONTH: 'SET_VIEW_MONTH',
  GO_TO_TODAY: 'GO_TO_TODAY',
  TOGGLE_YEAR_VIEW: 'TOGGLE_YEAR_VIEW',
  SELECT_DATE: 'SELECT_DATE',
  DESELECT_DATE: 'DESELECT_DATE',

  // ドロワー & モーダル
  OPEN_LEDGER: 'OPEN_LEDGER',
  CLOSE_LEDGER: 'CLOSE_LEDGER',
  OPEN_CREATE_FORM: 'OPEN_CREATE_FORM',
  OPEN_EDIT_FORM: 'OPEN_EDIT_FORM',
  CLOSE_FORM: 'CLOSE_FORM',
  OPEN_SIMULATOR: 'OPEN_SIMULATOR',
  CLOSE_SIMULATOR: 'CLOSE_SIMULATOR',

  // カラータグ管理
  ENTER_COLOR_DELETE: 'ENTER_COLOR_DELETE',
  EXIT_COLOR_DELETE: 'EXIT_COLOR_DELETE',

  // チャート操作
  SET_CHART_PERIOD: 'SET_CHART_PERIOD',
  SET_CHART_TYPE: 'SET_CHART_TYPE'
};

class AppStateMachine {
  constructor() {
    const now = new Date();
    this.state = STATES.CALENDAR_MONTH;
    this.previousState = null;

    this.context = {
      viewYear: now.getFullYear(),
      viewMonth: now.getMonth(),
      selectedDateStr: null,
      editingScenarioId: null,
      formMode: 'create', // 'create' | 'edit'
      chartPeriod: 'all', // '1y' | '3y' | '5y' | 'all'
      chartType: 'line',  // 'line' | 'stack'
      colorsMarkedForDelete: new Set(),
      isYearView: false
    };

    this.listeners = new Set();
  }

  /**
   * 現在の状態を取得
   */
  getState() {
    return this.state;
  }

  /**
   * 現在のコンテキストを取得
   */
  getContext() {
    return { ...this.context };
  }

  /**
   * 状態変更リスナーを登録
   * @param {Function} listener (state, context, event) => void
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * イベントを発行して状態を遷移
   * @param {string} event
   * @param {object} [payload={}]
   */
  dispatch(event, payload = {}) {
    const prev = this.state;
    let nextState = prev;
    const ctx = this.context;

    switch (event) {
      // ===== カレンダーナビゲーション =====
      case EVENTS.NAVIGATE_MONTH: {
        const delta = payload.delta || 0;
        let m = ctx.viewMonth + delta;
        let y = ctx.viewYear;
        while (m < 0) { m += 12; y--; }
        while (m > 11) { m -= 12; y++; }
        ctx.viewMonth = m;
        ctx.viewYear = y;
        break;
      }

      case EVENTS.SET_VIEW_YEAR: {
        if (typeof payload.year === 'number' && !isNaN(payload.year)) {
          ctx.viewYear = payload.year;
        }
        break;
      }

      case EVENTS.SET_VIEW_MONTH: {
        if (typeof payload.month === 'number' && payload.month >= 0 && payload.month <= 11) {
          ctx.viewMonth = payload.month;
        }
        break;
      }

      case EVENTS.GO_TO_TODAY: {
        const now = new Date();
        ctx.viewYear = now.getFullYear();
        ctx.viewMonth = now.getMonth();
        ctx.selectedDateStr = null;
        break;
      }

      case EVENTS.TOGGLE_YEAR_VIEW: {
        ctx.isYearView = !ctx.isYearView;
        nextState = ctx.isYearView ? STATES.CALENDAR_YEAR : STATES.CALENDAR_MONTH;
        break;
      }

      case EVENTS.SELECT_DATE: {
        ctx.selectedDateStr = payload.dateStr || null;
        break;
      }

      case EVENTS.DESELECT_DATE: {
        ctx.selectedDateStr = null;
        break;
      }

      // ===== 台帳一覧ドロワー =====
      case EVENTS.OPEN_LEDGER: {
        this.previousState = this.state;
        nextState = STATES.LEDGER_DRAWER;
        break;
      }

      case EVENTS.CLOSE_LEDGER: {
        nextState = ctx.isYearView ? STATES.CALENDAR_YEAR : STATES.CALENDAR_MONTH;
        break;
      }

      // ===== シナリオ作成/編集フォーム =====
      case EVENTS.OPEN_CREATE_FORM: {
        this.previousState = this.state;
        ctx.editingScenarioId = null;
        ctx.formMode = 'create';
        nextState = STATES.SCENARIO_FORM;
        break;
      }

      case EVENTS.OPEN_EDIT_FORM: {
        this.previousState = this.state;
        ctx.editingScenarioId = payload.scenarioId || null;
        ctx.formMode = 'edit';
        nextState = STATES.SCENARIO_FORM;
        break;
      }

      case EVENTS.CLOSE_FORM: {
        ctx.editingScenarioId = null;
        ctx.colorsMarkedForDelete.clear();
        nextState = this.previousState || (ctx.isYearView ? STATES.CALENDAR_YEAR : STATES.CALENDAR_MONTH);
        break;
      }

      // ===== 目標期日逆算シミュレーター =====
      case EVENTS.OPEN_SIMULATOR: {
        this.previousState = this.state;
        nextState = STATES.SIMULATOR;
        break;
      }

      case EVENTS.CLOSE_SIMULATOR: {
        nextState = ctx.isYearView ? STATES.CALENDAR_YEAR : STATES.CALENDAR_MONTH;
        break;
      }

      // ===== カラータグ削除モード =====
      case EVENTS.ENTER_COLOR_DELETE: {
        if (this.state === STATES.SCENARIO_FORM) {
          ctx.colorsMarkedForDelete.clear();
          nextState = STATES.COLOR_DELETE;
        }
        break;
      }

      case EVENTS.EXIT_COLOR_DELETE: {
        if (this.state === STATES.COLOR_DELETE) {
          ctx.colorsMarkedForDelete.clear();
          nextState = STATES.SCENARIO_FORM;
        }
        break;
      }

      // ===== チャート操作 =====
      case EVENTS.SET_CHART_PERIOD: {
        if (['1y', '3y', '5y', 'all'].includes(payload.period)) {
          ctx.chartPeriod = payload.period;
        }
        break;
      }

      case EVENTS.SET_CHART_TYPE: {
        if (['line', 'stack'].includes(payload.type)) {
          ctx.chartType = payload.type;
        }
        break;
      }

      default:
        console.warn(`[FSM] Unhandled event: ${event}`);
        return;
    }

    this.state = nextState;
    console.debug(`[FSM] ${prev} -> ${this.state} (Event: ${event})`, { context: ctx });

    // リスナーに通知
    this.listeners.forEach(listener => {
      try {
        listener(this.state, this.getContext(), event);
      } catch (err) {
        console.error('[FSM] Error in listener callback:', err);
      }
    });
  }
}

// シングルトンインスタンスをエクスポート
export const fsm = new AppStateMachine();
