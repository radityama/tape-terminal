import { create } from 'zustand';
import { COMPANY_MAP } from '../data/companies';
import { MarketSimulationEngine, MarketSnapshot, SimSpeed } from '../engine/market';
import { OrderSide, OrderType, TimeInForce } from '../engine/matching';
import { Scenario, SCENARIOS } from '../data/scenarios';
import { saveManager, SaveStatus } from '../saves/manager';
import { Profile, SaveGame } from '../saves/schema';
import { useAuthStore } from './useAuthStore';

export type BottomTab = 'positions' | 'orders' | 'blotter' | 'risk' | 'calendar' | 'leaderboard';
export type WorkspaceLayout = 'trade' | 'research' | 'risk';
export type ModalType = 'none' | 'company' | 'screener' | 'career' | 'eod' | 'scenario-result' | 'settings' | 'scenarios' | 'saves';
export type ChartTimeframe = '1m' | '5m' | '15m' | '1h' | '1D';

export interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'warning' | 'info' | 'error';
  timestamp: number;
}

export interface PriceQuote {
  ticker: string;
  price: number;
  rawPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  direction: 'up' | 'down' | 'flat';
  lastMoveDirection: 'up' | 'down';
  high: number;
  low: number;
  vwap: number;
}

export interface TerminalState {
  // Engine instance
  engine: MarketSimulationEngine | null;
  seed: string;
  mode: 'career' | 'sandbox';
  difficulty: 'learner' | 'standard' | 'hardcore';
  activeScenario: Scenario | null;

  // Primary Selection
  selectedTicker: string;
  selectedTimeframe: ChartTimeframe;
  chartIndicators: {
    volume: boolean;
    sma20: boolean;
    ema50: boolean;
    vwap: boolean;
    bollinger: boolean;
    rsi: boolean;
    macd: boolean;
  };

  // UI state
  activeBottomTab: BottomTab;
  activeWorkspaceLayout: WorkspaceLayout;
  activeModal: ModalType;
  companyModalTicker: string | null;
  commandBarOpen: boolean;

  // Settings
  soundEnabled: boolean;
  tapeStripEnabled: boolean;
  priceFlashSetting: 'off' | 'subtle' | 'full';

  // Granular prices map for zero-lag cell-level subscriptions
  pricesByTicker: Record<string, PriceQuote>;

  // Tutorial
  tutorialActive: boolean;
  tutorialStep: number;
  tutorialCompleted: boolean;

  // Notifications & Alerts
  toasts: ToastNotification[];
  priceAlerts: Array<{ id: string; ticker: string; targetPrice: number; direction: 'above' | 'below'; triggered: boolean }>;

  // Live Snapshot
  snapshot: MarketSnapshot | null;

  // Save state
  saveStatus: SaveStatus;
  // Identifies the live engine instance for the capture hydration gate.
  engineId: string | null;
  // Hydration gate phases for a session (loading gate for autosave).
  sessionPhase: 'idle' | 'loading' | 'ready' | 'recovery';
  sessionError: string | null;

  // Actions
  initEngine: (seed?: string, mode?: 'career' | 'sandbox', startingBalance?: number) => void;
  // Hydrate a session: restore the stored slot when present, otherwise start fresh.
  initSession: (seed?: string, mode?: 'career' | 'sandbox', startingBalance?: number) => Promise<void>;
  restoreFromSave: (save: SaveGame) => void;
  setSnapshot: (snapshot: MarketSnapshot) => void;
  setSelectedTicker: (ticker: string) => void;
  setSelectedTimeframe: (tf: ChartTimeframe) => void;
  toggleChartIndicator: (indicator: keyof TerminalState['chartIndicators']) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
  setActiveWorkspaceLayout: (layout: WorkspaceLayout) => void;
  setActiveModal: (modal: ModalType, ticker?: string) => void;
  setCommandBarOpen: (open: boolean) => void;
  setSimSpeed: (speed: SimSpeed) => void;
  toggleSound: () => void;
  toggleTapeStrip: () => void;
  setPriceFlashSetting: (setting: 'off' | 'subtle' | 'full') => void;
  setDifficulty: (diff: 'learner' | 'standard' | 'hardcore') => void;
  // Apply a cloud profile that won the last-write-wins comparison.
  applyProfile: (profile: Profile) => void;
  startScenario: (scenario: Scenario) => void;

  // Tutorial actions
  nextTutorialStep: () => void;
  prevTutorialStep: () => void;
  skipTutorial: () => void;
  restartTutorial: () => void;

  // Order actions
  placeOrder: (params: {
    ticker: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    limitPrice?: number;
    stopPrice?: number;
    trailingAmount?: number;
    timeInForce?: TimeInForce;
    takeProfitPrice?: number;
    stopLossPrice?: number;
  }) => { success: boolean; error?: string };
  cancelOrder: (orderId: string) => boolean;

  // Notification actions
  addToast: (toast: Omit<ToastNotification, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  addPriceAlert: (ticker: string, price: number, direction: 'above' | 'below') => void;
  dismissEodReport: () => void;
  skipToNextDay: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  engine: null,
  seed: 'TAPE_1337',
  mode: 'career',
  difficulty: 'standard',
  activeScenario: null,

  selectedTicker: 'HLVG',
  selectedTimeframe: '5m',
  chartIndicators: {
    volume: true,
    sma20: true,
    ema50: false,
    vwap: true,
    bollinger: false,
    rsi: false,
    macd: false,
  },

  activeBottomTab: 'positions',
  activeWorkspaceLayout: 'trade',
  activeModal: 'none',
  companyModalTicker: null,
  commandBarOpen: false,

  soundEnabled: false,
  tapeStripEnabled: true,
  priceFlashSetting: 'subtle',

  pricesByTicker: {},

  tutorialActive: false,
  tutorialStep: 1,
  tutorialCompleted: false,

  toasts: [],
  priceAlerts: [],
  snapshot: null,

  saveStatus: 'saved_locally',
  engineId: null,
  sessionPhase: 'idle',
  sessionError: null,

  initEngine: (seed = 'TAPE_1337', mode = 'career', startingBalance = 100000) => {
    const engine = new MarketSimulationEngine(seed, startingBalance);
    wireEngine(engine, get);
    const initialSnap = engine.getSnapshot();
    const engineId = newEngineId();
    set({ engine, engineId, seed, mode, snapshot: initialSnap, pricesByTicker: buildPriceMap(initialSnap), sessionPhase: 'ready', sessionError: null });
    saveManager.bindSession(saveManager.getActiveSlot(), engineId);
    saveManager.markSessionReady();
  },

  initSession: async (seed = 'TAPE_1337', mode = 'career', startingBalance = 100000) => {
    if (get().sessionPhase === 'loading' || get().sessionPhase === 'ready') return;
    set({ sessionPhase: 'loading', sessionError: null, engine: null, engineId: null, snapshot: null });
    let recoveryMessage = 'Could not safely restore or verify your saves. Your saved data has not been replaced. Retry, or return to the title screen to inspect your slots.';
    try {
      useAuthStore.getState().init();
      if (!useAuthStore.getState().ready) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Authentication check timed out')); }, 10000);
          const unsubscribe = useAuthStore.subscribe((state) => {
            if (state.ready) { clearTimeout(timeout); unsubscribe(); resolve(); }
          });
          if (useAuthStore.getState().ready) { clearTimeout(timeout); unsubscribe(); resolve(); }
        });
      }
      if (useAuthStore.getState().hydrationError) {
        recoveryMessage = 'Could not check your account session. Retry before loading or starting a game; cloud saves may still exist.';
        throw new Error('Authentication check failed');
      }
      const authUserId = useAuthStore.getState().user?.id ?? null;
      const authUnchanged = () => useAuthStore.getState().ready && (useAuthStore.getState().user?.id ?? null) === authUserId;
      const slots = await saveManager.listAllSlots();
      if (!authUnchanged()) throw new Error('Account changed while checking saves.');
      const preferred = saveManager.getActiveSlot();
      const target = slots.find((entry) => entry.slot === preferred) ?? slots[0];
      if (target) {
        if (target.health !== 'healthy') {
          recoveryMessage = target.health === 'unsupported_version'
            ? 'This local save was made by a newer version of TAPE. Its original data is still stored.'
            : 'This local save could not be read. Its original data is still stored.';
          throw new Error('Local save needs recovery');
        }
        const outcome = await saveManager.load(target.slot, authUnchanged);
        if (!outcome.ok) {
          recoveryMessage = outcome.reason === 'newer' ? 'This save needs a newer version of TAPE. Its original data is still stored.'
            : outcome.reason === 'corrupt' ? 'This save could not be read. Its original data is still stored.'
              : outcome.reason === 'conflict' ? 'This device and cloud have conflicting saves. Both copies are preserved. Return to the title screen to choose how to resolve them.'
                : 'The selected save could not be found. Retry to check your saves.';
          throw new Error('Save load failed');
        }
        if (!get().engine) throw new Error('The save could not initialize the game.');
        set({ sessionPhase: 'ready', sessionError: null });
      } else {
        if (!authUnchanged()) throw new Error('Account changed while checking saves.');
        get().initEngine(seed, mode, startingBalance);
      }
    } catch {
      saveManager.endSession();
      set({ engine: null, engineId: null, snapshot: null, pricesByTicker: {}, sessionPhase: 'recovery', sessionError: recoveryMessage });
    }
  },

  restoreFromSave: (save) => {
    const engine = new MarketSimulationEngine(save.seed, 100000);
    engine.importState(save.game);
    wireEngine(engine, get);
    const snapshot = engine.getSnapshot();
    const run = engine.getScenarioRun();
    const scenarioId = run?.id ?? save.scenarioId;
    const scenario = scenarioId ? (SCENARIOS.find((s) => s.id === scenarioId) ?? null) : null;
    const engineId = newEngineId();
    set({
      engine,
      engineId,
      seed: save.seed,
      mode: save.mode,
      activeScenario: scenario,
      activeModal: run?.result ? 'scenario-result' : 'none',
      snapshot,
      pricesByTicker: buildPriceMap(snapshot),
      sessionPhase: 'ready',
      sessionError: null,
    });
    saveManager.bindSession(save.slot, engineId);
    saveManager.markSessionReady();
  },

  setSnapshot: (snapshot) => {
    const engine = get().engine;
    const run = engine?.getScenarioRun();
    const prevDay = get().snapshot?.simDay;
    const dayChanged = prevDay !== undefined && snapshot.simDay !== prevDay;
    if (dayChanged) {
      // Completion is a one-time result: persist it now, before the debounced autosave.
      if (run?.result) saveManager.notePlayerAction();
      else saveManager.noteSimDay();
    }

    const prevMap = get().pricesByTicker;
    let mapChanged = false;
    const newMap: Record<string, PriceQuote> = { ...prevMap };

    for (const p of snapshot.prices) {
      const prev = prevMap[p.ticker];
      const quantizedPrice = Math.round(p.price * 100) / 100;

      // Check if price quantized, change, changePercent, or volume changed
      if (
        prev &&
        prev.price === quantizedPrice &&
        prev.change === p.change &&
        prev.changePercent === p.changePercent &&
        prev.volume === p.volume &&
        prev.direction === p.direction
      ) {
        // Keep identical reference to prevent unnecessary cell re-renders
        continue;
      }

      mapChanged = true;
      newMap[p.ticker] = {
        ticker: p.ticker,
        price: quantizedPrice,
        rawPrice: p.price,
        change: p.change,
        changePercent: p.changePercent,
        volume: p.volume,
        direction: p.direction,
        lastMoveDirection: p.lastMoveDirection || (p.change >= 0 ? 'up' : 'down'),
        high: p.high,
        low: p.low,
        vwap: p.vwap,
      };
    }

    const openCompletion = dayChanged && run?.result
      && get().activeModal === 'none'
      && engine?.getCurrentEodModal() !== null;
    if (mapChanged) {
      set({ snapshot, pricesByTicker: newMap, ...(openCompletion ? { activeModal: 'eod' as const } : {}) });
    } else {
      set({ snapshot, ...(openCompletion ? { activeModal: 'eod' as const } : {}) });
    }
  },

  setSelectedTicker: (ticker) => {
    if (COMPANY_MAP.has(ticker)) {
      set({ selectedTicker: ticker });
    }
  },

  setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

  toggleChartIndicator: (indicator) => {
    set((state) => ({
      chartIndicators: {
        ...state.chartIndicators,
        [indicator]: !state.chartIndicators[indicator],
      },
    }));
  },

  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
  setActiveWorkspaceLayout: (layout) => set({ activeWorkspaceLayout: layout }),
  setActiveModal: (modal, ticker) => set({ activeModal: modal, companyModalTicker: ticker || null }),
  setCommandBarOpen: (open) => set({ commandBarOpen: open }),

  setSimSpeed: (speed) => {
    const { engine } = get();
    if (engine) {
      engine.setSpeed(speed);
      set({ snapshot: engine.getSnapshot() });
      if (speed === 0) saveManager.notePause();
    }
  },

  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  toggleTapeStrip: () => set((state) => ({ tapeStripEnabled: !state.tapeStripEnabled })),
  setPriceFlashSetting: (setting) => set({ priceFlashSetting: setting }),
  setDifficulty: (diff) => set({ difficulty: diff }),

  applyProfile: (profile) => {
    const settings = profile.settings;
    set((state) => ({
      difficulty: settings.difficulty,
      soundEnabled: settings.soundEnabled,
      tapeStripEnabled: settings.tapeStripEnabled,
      priceFlashSetting: ['off', 'subtle', 'full'].includes(settings.priceFlashSetting)
        ? (settings.priceFlashSetting as 'off' | 'subtle' | 'full')
        : state.priceFlashSetting,
      selectedTimeframe: settings.selectedTimeframe,
      activeWorkspaceLayout: settings.activeWorkspaceLayout,
      chartIndicators: { ...settings.chartIndicators },
      tutorialStep: profile.tutorial.step,
      tutorialCompleted: profile.tutorial.completed,
    }));
  },

  startScenario: (scenario) => {
    get().initEngine(scenario.seed, 'sandbox', 100000);
    const { engine } = get();
    if (engine) {
      engine.startScenario(scenario);
      set({ activeScenario: scenario, activeModal: 'none', selectedTicker: scenario.featuredTickers[0] });
    }
  },

  nextTutorialStep: () => {
    const current = get().tutorialStep;
    if (current < 9) {
      set({ tutorialStep: current + 1 });
    } else {
      set({ tutorialActive: false, tutorialCompleted: true });
    }
  },

  prevTutorialStep: () => {
    const current = get().tutorialStep;
    if (current > 1) {
      set({ tutorialStep: current - 1 });
    }
  },

  skipTutorial: () => set({ tutorialActive: false, tutorialCompleted: true }),

  restartTutorial: () => {
    const { engine } = get();
    if (engine) engine.setSpeed(0); // pause during tutorial
    set({ tutorialActive: true, tutorialStep: 1, commandBarOpen: false, activeModal: 'none' });
  },

  placeOrder: (params) => {
    const { engine } = get();
    if (!engine) return { success: false, error: 'Engine not ready.' };
    const res = engine.placeOrder(params);
    if (!res.success && res.error) {
      get().addToast({
        title: 'Order Rejected',
        message: res.error,
        type: 'error',
      });
    } else if (res.success) {
      // Pending order changes position state too; flush immediately.
      saveManager.notePlayerAction();
    }
    // Refresh snapshot immediately
    set({ snapshot: engine.getSnapshot() });
    return res;
  },

  cancelOrder: (orderId) => {
    const { engine } = get();
    if (!engine) return false;
    const ok = engine.cancelOrder(orderId);
    if (ok) {
      get().addToast({
        title: 'Order Cancelled',
        message: `Order ${orderId} was removed from the book.`,
        type: 'info',
      });
      saveManager.notePlayerAction();
      set({ snapshot: engine.getSnapshot() });
    }
    return ok;
  },

  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastNotification = {
      id,
      timestamp: Date.now(),
      ...toast,
    };
    set((state) => ({ toasts: [...state.toasts.slice(-4), newToast] }));

    // Auto dismiss after 4 seconds
    setTimeout(() => {
      get().removeToast(id);
    }, 4000);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  addPriceAlert: (ticker, targetPrice, direction) => {
    const id = `alert_${Date.now()}`;
    set((state) => ({
      priceAlerts: [...state.priceAlerts, { id, ticker, targetPrice, direction, triggered: false }],
    }));
    get().addToast({
      title: 'Price Alert Set',
      message: `Alert set for ${ticker} when price crosses ${direction} $${targetPrice.toFixed(2)}.`,
      type: 'info',
    });
  },

  dismissEodReport: () => {
    const { engine } = get();
    if (engine) engine.dismissEodModal();
    set({ activeModal: engine?.getScenarioRun()?.result ? 'scenario-result' : 'none' });
  },

  skipToNextDay: () => {
    const { engine } = get();
    if (engine && !engine.getScenarioRun()?.result) {
      engine.skipToNextDay();
      set({ snapshot: engine.getSnapshot(), activeModal: 'eod' });
      // The snapshot is set directly here, so the day-change autosave in setSnapshot never
      // runs. Persist the skipped day immediately like any other player action; otherwise a
      // reload before the next timer tick reopens the day that was just settled.
      saveManager.notePlayerAction();
    }
  },
}));

function quoteFrom(p: MarketSnapshot['prices'][number]): PriceQuote {
  return {
    ticker: p.ticker,
    price: Math.round(p.price * 100) / 100,
    rawPrice: p.price,
    change: p.change,
    changePercent: p.changePercent,
    volume: p.volume,
    direction: p.direction,
    lastMoveDirection: p.lastMoveDirection || (p.change >= 0 ? 'up' : 'down'),
    high: p.high,
    low: p.low,
    vwap: p.vwap,
  };
}

function buildPriceMap(snapshot: MarketSnapshot): Record<string, PriceQuote> {
  const map: Record<string, PriceQuote> = {};
  for (const p of snapshot.prices) map[p.ticker] = quoteFrom(p);
  return map;
}

function newEngineId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `engine_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function wireEngine(engine: MarketSimulationEngine, get: () => TerminalState) {
  engine.setCallbacks({
    onSnapshot: (snap) => {
      get().setSnapshot(snap);
    },
    onTradeFill: (trade) => {
      // A fill changes positions: write the local save immediately so a reload keeps it.
      saveManager.notePlayerAction();
      get().addToast({
        title: 'Order Executed',
        message: `${trade.side.toUpperCase()} ${trade.shares} ${trade.ticker} @ $${trade.price.toFixed(2)}`,
        type: 'success',
      });

      const state = get();
      if (state.tutorialActive && state.tutorialStep === 6) {
        state.nextTutorialStep();
      }
    },
    onOrderTriggered: () => {
      // A stop-limit latch changes saved order state even when no fill occurs.
      saveManager.notePlayerAction();
    },
    onMarginCall: (explanation) => {
      get().addToast({
        title: 'Margin Call Forced Liquidation',
        message: explanation,
        type: 'error',
      });
    },
    onAchievement: (ach) => {
      get().addToast({
        title: `Achievement Unlocked: ${ach.title}`,
        message: ach.description,
        type: 'info',
      });
    },
  });
}

// The store is the only thing that touches the engine; the SaveManager only ever sees plain save data.
saveManager.init({
  capture: (slot) => {
    const state = useTerminalStore.getState();
    if (!state.engine) return null;
    const snap = state.snapshot ?? state.engine.getSnapshot();
    const career = snap.career as { rank?: { name?: string } } | undefined;
    return {
      engineId: state.engineId,
      name: state.activeScenario?.title ?? (state.mode === 'career' ? `Career ${slot}` : `Sandbox ${slot}`),
      seed: state.seed,
      mode: state.mode,
      scenarioId: state.engine.getScenarioRun()?.id ?? state.activeScenario?.id ?? null,
      summary: {
        rank: career?.rank?.name ?? null,
        equity: snap.riskMetrics.netLiquidationValue,
        simDay: snap.simDay,
      },
      game: state.engine.exportState(),
    };
  },
  restore: (save) => useTerminalStore.getState().restoreFromSave(save),
  onStatus: (status) => useTerminalStore.setState({ saveStatus: status }),
  onNotice: (message) =>
    useTerminalStore.getState().addToast({ title: 'Save repaired', message, type: 'warning' }),
  captureProfile: () => {
    const state = useTerminalStore.getState();
    return {
      schemaVersion: 1,
      settings: {
        difficulty: state.difficulty,
        soundEnabled: state.soundEnabled,
        tapeStripEnabled: state.tapeStripEnabled,
        priceFlashSetting: state.priceFlashSetting,
        selectedTimeframe: state.selectedTimeframe,
        activeWorkspaceLayout: state.activeWorkspaceLayout,
        chartIndicators: { ...state.chartIndicators },
      },
      tutorial: { completed: state.tutorialCompleted, step: state.tutorialStep },
      layouts: {},
      updatedAt: Date.now(),
    };
  },
  applyProfile: (profile) => {
    applyingRemoteProfile = true;
    try {
      useTerminalStore.getState().applyProfile(profile);
    } finally {
      applyingRemoteProfile = false;
    }
  },
});

// Profile fields that live in the cloud blob. Any change writes local at once and
// pushes to the cloud debounced through the save manager.
const PROFILE_KEYS = [
  'difficulty',
  'soundEnabled',
  'tapeStripEnabled',
  'priceFlashSetting',
  'selectedTimeframe',
  'activeWorkspaceLayout',
  'chartIndicators',
  'tutorialStep',
  'tutorialCompleted',
] as const;

let applyingRemoteProfile = false;

useTerminalStore.subscribe((state, previous) => {
  if (applyingRemoteProfile) return;
  if (PROFILE_KEYS.some((key) => state[key] !== previous[key])) {
    void saveManager.noteProfileChange();
  }
});
