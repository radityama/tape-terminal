import { COMPANIES, Company, COMPANY_MAP, Sector, SECTORS } from '../data/companies';
import { CareerEngine, CareerEngineState } from './career';
import { MarketRegime } from './correlation';
import { EventGenerator, MarketEvent } from './events';
import { Order, OrderMatchingEngine, OrderSide, OrderType, TimeInForce, TradeRecord, isValidPendingOrder, validOrderValue, validateOrderInput } from './matching';
import { OrderBookDepth, OrderBookEngine } from './orderbook';
import { PortfolioEngine, PortfolioEngineState, Position, RiskMetrics } from './portfolio';
import { Candle, PricingEngine, PricingEngineState } from './pricing';
import { RivalEngine, RivalTrader, RivalEngineState } from './rivals';
import { SeededRNG } from './rng';

export type SimSession = 'pre_market' | 'regular' | 'after_hours' | 'closed';
export type SimSpeed = 0 | 1 | 5 | 20;

export interface MarketIndex {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

export interface EndOfDayReport {
  day: number;
  dateStr: string;
  startingEquity: number;
  endingEquity: number;
  netPnl: number;
  returnPct: number;
  bestTrade?: TradeRecord;
  worstTrade?: TradeRecord;
  coachNote: string;
  sectorAttribution: Array<{ sector: Sector; pnl: number }>;
}

export interface MarketSnapshot {
  simDay: number;
  simTimeStr: string; // "10:42:15"
  session: SimSession;
  regime: MarketRegime;
  tape50: MarketIndex;
  sectorIndices: MarketIndex[];
  prices: Array<{
    ticker: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    direction: 'up' | 'down' | 'flat';
    lastMoveDirection?: 'up' | 'down';
    high: number;
    low: number;
    vwap: number;
  }>;
  riskMetrics: RiskMetrics;
  positions: Position[];
  openOrders: Order[];
  recentTrades: TradeRecord[];
  activeNews: MarketEvent[];
  upcomingEarnings: MarketEvent[];
  rivals: RivalTrader[];
  career: {
    rank: any;
    nextRank: any;
    reputation: number;
    riskBreaches: number;
    objectives: any[];
    achievements: any[];
  };
}

export interface MarketEngineState {
  seed: string;
  speed: number;
  simDay: number;
  simSecondsOfDay: number;
  session: SimSession;
  rngState: number;
  // Monotonic counter bumped on sim day advances and player actions; drives the save seq guard.
  actionSeq: number;
  // Earnings jumps queued at the end of a day and applied on the next price step.
  activeJumpDeltas: Array<[string, number]>;
  pricing: PricingEngineState;
  portfolio: PortfolioEngineState;
  career: CareerEngineState;
  rivals: RivalEngineState;
  openOrders: Order[];
  activeNews: MarketEvent[];
  upcomingEarnings: MarketEvent[];
}

export class MarketSimulationEngine {
  public seed: string;
  private rng: SeededRNG;
  private companies: Company[];
  private pricingEngine: PricingEngine;
  private bookEngine: OrderBookEngine;
  private matchingEngine: OrderMatchingEngine;
  private portfolioEngine: PortfolioEngine;
  private eventGenerator: EventGenerator;
  private rivalEngine: RivalEngine;
  private careerEngine: CareerEngine;

  // Time tracking
  // 1 sim day = 6 real minutes at 1x speed = 360 seconds real time for 6.5 sim hours (23,400 sim seconds)
  // Time scale factor: 23,400 / 360 = 65 sim seconds per real second at 1x
  private speed: SimSpeed = 1;
  private simDay: number = 1;
  private actionSeq: number = 0;
  private simSecondsOfDay: number = 9.5 * 3600; // start at 09:30:00 (34,200 seconds)
  private session: SimSession = 'regular';
  private lastRealTimestamp: number = Date.now();

  // Active state
  private openOrders: Map<string, Order> = new Map();
  private activeNews: MarketEvent[] = [];
  private upcomingEarnings: MarketEvent[] = [];
  private activeJumpDeltas: Map<string, number> = new Map();
  private eodReports: EndOfDayReport[] = [];
  private currentEodModal: EndOfDayReport | null = null;
  private depthCache: Map<string, OrderBookDepth> = new Map();

  // Callbacks for subscribers
  private onSnapshotCallback?: (snapshot: MarketSnapshot) => void;
  private onTradeFillCallback?: (trade: TradeRecord) => void;
  private onMarginCallCallback?: (explanation: string) => void;
  private onAchievementCallback?: (ach: any) => void;

  constructor(seed: string = 'TAPE_1337', startingBalance: number = 100000) {
    this.seed = seed;
    this.rng = new SeededRNG(seed);
    this.companies = [...COMPANIES];
    this.pricingEngine = new PricingEngine(this.rng, this.companies);
    this.bookEngine = new OrderBookEngine(this.rng);
    this.matchingEngine = new OrderMatchingEngine(this.bookEngine);
    this.portfolioEngine = new PortfolioEngine(startingBalance);
    this.eventGenerator = new EventGenerator(this.rng);
    this.rivalEngine = new RivalEngine(this.rng);
    this.careerEngine = new CareerEngine();

    // Initial earnings schedule
    this.upcomingEarnings = this.eventGenerator.generateEarningsCalendar(this.companies, 1, 45);

    // Initial depth cache
    for (const comp of this.companies) {
      const depth = this.bookEngine.generateDepth(comp, comp.initialPrice, 'bull');
      this.depthCache.set(comp.ticker, depth);
    }
  }

  setSpeed(speed: SimSpeed) {
    this.speed = speed;
  }

  getSpeed(): SimSpeed {
    return this.speed;
  }

  // Full state snapshot for persistence. Depth cache and EOD reports are derived and not stored.
  exportState(): MarketEngineState {
    return {
      seed: this.seed,
      speed: this.speed,
      simDay: this.simDay,
      simSecondsOfDay: this.simSecondsOfDay,
      session: this.session,
      rngState: this.rng.getState(),
      actionSeq: this.actionSeq,
      activeJumpDeltas: Array.from(this.activeJumpDeltas.entries()),
      pricing: this.pricingEngine.exportState(),
      portfolio: this.portfolioEngine.exportState(),
      career: this.careerEngine.exportState(),
      rivals: this.rivalEngine.exportState(),
      openOrders: Array.from(this.openOrders.values()).map((o) => ({ ...o })),
      activeNews: this.activeNews.map((n) => ({ ...n })),
      upcomingEarnings: this.upcomingEarnings.map((n) => ({ ...n })),
    };
  }

  importState(state: MarketEngineState) {
    this.seed = state.seed;
    this.speed = state.speed as SimSpeed;
    this.simDay = state.simDay;
    this.simSecondsOfDay = state.simSecondsOfDay;
    this.session = state.session;
    this.pricingEngine.importState(state.pricing);
    this.portfolioEngine.importState(state.portfolio);
    this.careerEngine.importState(state.career);
    this.rivalEngine.importState(state.rivals);
    this.openOrders = new Map(state.openOrders.map((o) => [o.id, { ...o }]));
    this.activeNews = state.activeNews.map((n) => ({ ...n }));
    this.upcomingEarnings = state.upcomingEarnings.map((n) => ({ ...n }));
    // A jump queued by concludeTradingDay applies on the next tick, so it is real state.
    this.activeJumpDeltas = new Map(state.activeJumpDeltas ?? []);
    this.eodReports = [];
    this.currentEodModal = null;
    this.depthCache.clear();
    for (const comp of this.companies) {
      const s = this.pricingEngine.getState(comp.ticker);
      if (s) this.depthCache.set(comp.ticker, this.bookEngine.generateDepth(comp, s.price, this.pricingEngine.getRegime()));
    }
    // Restore the RNG counter last: rebuilding the derived depth cache above consumes draws.
    this.rng.setState(state.rngState);
    this.actionSeq = typeof state.actionSeq === 'number' ? state.actionSeq : 0;
  }

  setCallbacks(cbs: {
    onSnapshot?: (snapshot: MarketSnapshot) => void;
    onTradeFill?: (trade: TradeRecord) => void;
    onMarginCall?: (explanation: string) => void;
    onAchievement?: (ach: any) => void;
  }) {
    this.onSnapshotCallback = cbs.onSnapshot;
    this.onTradeFillCallback = cbs.onTradeFill;
    this.onMarginCallCallback = cbs.onMarginCall;
    this.onAchievementCallback = cbs.onAchievement;
  }

  // Place order into matching engine
  placeOrder(params: {
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
  }): { success: boolean; orderId?: string; error?: string } {
    const validationError = validateOrderInput(params);
    if (validationError) return { success: false, error: validationError };

    const comp = COMPANY_MAP.get(params.ticker);
    if (!comp) return { success: false, error: 'Unknown ticker symbol.' };

    const priceState = this.pricingEngine.getState(params.ticker);
    if (!priceState) return { success: false, error: 'Price not available.' };

    const depth = this.depthCache.get(params.ticker) || this.bookEngine.generateDepth(comp, priceState.price, this.pricingEngine.getRegime());
    const estFill = this.bookEngine.simulateFill(params.side, params.quantity, depth);
    const commission = this.matchingEngine.calculateCommission(params.quantity, estFill.averagePrice);
    if (!validOrderValue(params.quantity, estFill.averagePrice)
      || !Number.isSafeInteger(Math.round(estFill.totalCost * 100))
      || !Number.isFinite(commission)) {
      return { success: false, error: 'Order value is out of range.' };
    }

    // Check buying power requirements
    const risk = this.portfolioEngine.calculateRiskMetrics(COMPANY_MAP);
    const requiredCapital = estFill.totalCost + commission;

    if (params.side === 'buy' && requiredCapital > risk.buyingPower) {
      return {
        success: false,
        error: `Insufficient buying power: need $${requiredCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, have $${risk.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
      };
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const order: Order = {
      id: orderId,
      ticker: params.ticker,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      filledQuantity: 0,
      limitPrice: params.limitPrice,
      stopPrice: params.stopPrice,
      trailingAmount: params.trailingAmount,
      timeInForce: params.timeInForce || 'DAY',
      status: 'pending',
      createdAt: Date.now(),
      commissionPaid: 0,
      takeProfitPrice: params.takeProfitPrice,
      stopLossPrice: params.stopLossPrice,
    };

    this.openOrders.set(orderId, order);

    // If market order, evaluate fill immediately
    if (params.type === 'market') {
      this.evaluateOrder(order, depth, priceState.price);
    }

    this.actionSeq += 1;
    return { success: true, orderId };
  }

  cancelOrder(orderId: string): boolean {
    const order = this.openOrders.get(orderId);
    if (order && (order.status === 'pending' || order.status === 'partially_filled')) {
      order.status = 'cancelled';
      this.openOrders.delete(orderId);
      this.actionSeq += 1;
      return true;
    }
    return false;
  }

  // Step the simulation tick by deltaTimeSec
  tick(realDeltaSeconds: number) {
    if (this.speed === 0) return;

    // Time scaling: 65 sim seconds per real second at 1x
    const simDeltaSeconds = realDeltaSeconds * 65 * this.speed;
    this.simSecondsOfDay += simDeltaSeconds;

    // Session determination (09:30 to 16:00 is Regular)
    const openSec = 9.5 * 3600;
    const closeSec = 16.0 * 3600;

    if (this.simSecondsOfDay < openSec) {
      this.session = 'pre_market';
    } else if (this.simSecondsOfDay <= closeSec) {
      this.session = 'regular';
    } else {
      this.session = 'after_hours';
    }

    // End of day transition check (16:30 end of session)
    if (this.simSecondsOfDay >= 16.5 * 3600) {
      this.concludeTradingDay();
      return;
    }

    // Intraday fraction: 0.0 at open to 1.0 at close
    const intradayFraction = Math.max(0, Math.min(1.0, (this.simSecondsOfDay - openSec) / (closeSec - openSec)));

    // Spontaneous News Generator (probabilistic check)
    if (this.rng.next() < 0.015 * realDeltaSeconds * this.speed) {
      const news = this.eventGenerator.generateRandomNews(this.companies, this.simDay, Date.now());
      if (news) {
        this.activeNews.unshift(news);
        if (this.activeNews.length > 20) this.activeNews.pop();

        if (news.ticker) {
          this.activeJumpDeltas.set(news.ticker, news.trueImpact);
        }
      }
    }

    // Step pricing engine
    const tickDeltas = this.pricingEngine.stepTick(
      this.companies,
      intradayFraction,
      realDeltaSeconds,
      simDeltaSeconds,
      this.activeJumpDeltas,
      this.speed
    );
    this.activeJumpDeltas.clear();

    // Update candle bars
    const currentSimEpochSec = Math.floor(Date.now() / 1000);
    this.pricingEngine.updateCandles(currentSimEpochSec);

    // Update order book depth caches and match active orders
    const priceMap = this.pricingEngine.getPriceMap();
    const regime = this.pricingEngine.getRegime();

    for (const comp of this.companies) {
      const priceState = this.pricingEngine.getState(comp.ticker);
      if (!priceState) continue;

      const depth = this.bookEngine.generateDepth(comp, priceState.price, regime);
      this.depthCache.set(comp.ticker, depth);

      // Check open orders for this ticker
      for (const order of this.openOrders.values()) {
        if (order.ticker === comp.ticker && (order.status === 'pending' || order.status === 'partially_filled')) {
          this.evaluateOrder(order, depth, priceState.price);
        }
      }
    }

    // Update mark-to-market prices on portfolio
    this.portfolioEngine.updateMarketPrices(priceMap);

    // Check margin cushion and margin calls
    const risk = this.portfolioEngine.calculateRiskMetrics(COMPANY_MAP);
    if (risk.isMarginBreached) {
      const liq = this.portfolioEngine.liquidateLargestLoser(priceMap, Date.now());
      if (liq && this.onMarginCallCallback) {
        this.onMarginCallCallback(liq.explanation);
      }
    }

    // Check rank up
    const rankResult = this.careerEngine.checkRankUp(risk.netLiquidationValue);
    if (rankResult.rankedUp && rankResult.newRank) {
      // Unlock new capabilities
      const isJunior = rankResult.newRank.order >= 2;
      const isTrader = rankResult.newRank.order >= 3;
      this.portfolioEngine.setUnlockedFeatures(isTrader, isJunior);
    }
  }

  private evaluateOrder(order: Order, depth: OrderBookDepth, currentPrice: number) {
    const fillResult = this.matchingEngine.evaluatePendingOrder(order, depth, currentPrice);
    if (!fillResult || !fillResult.shouldFill) return;

    const remainingShares = order.quantity - order.filledQuantity;
    const commission = this.matchingEngine.calculateCommission(remainingShares, fillResult.fillPrice);
    const fillRes = this.portfolioEngine.executeFill({
      orderId: order.id,
      ticker: order.ticker,
      side: order.side,
      shares: remainingShares,
      price: fillResult.fillPrice,
      commission,
      slippageDollars: fillResult.slippage,
      timestamp: Date.now(),
      initialStopPrice: order.stopLossPrice,
    });

    if (fillRes.success && fillRes.tradeRecord) {
      order.status = 'filled';
      order.filledQuantity = order.quantity;
      order.filledAt = Date.now();
      order.averageFillPrice = fillResult.fillPrice;
      order.commissionPaid += commission;
      this.openOrders.delete(order.id);
      this.actionSeq += 1;

      // First fill achievement
      const ach = this.careerEngine.unlockAchievement('first_fill');
      if (ach && this.onAchievementCallback) {
        this.onAchievementCallback(ach);
      }

      // If bracket child orders are attached, spawn them
      if (order.takeProfitPrice && order.takeProfitPrice > 0) {
        const tpSide: OrderSide = order.side === 'buy' ? 'sell' : 'buy';
        this.placeOrder({
          ticker: order.ticker,
          side: tpSide,
          type: 'limit',
          quantity: remainingShares,
          limitPrice: order.takeProfitPrice,
          timeInForce: 'GTC',
        });
      }

      if (order.stopLossPrice && order.stopLossPrice > 0) {
        const slSide: OrderSide = order.side === 'buy' ? 'sell' : 'buy';
        this.placeOrder({
          ticker: order.ticker,
          side: slSide,
          type: 'stop',
          quantity: remainingShares,
          stopPrice: order.stopLossPrice,
          timeInForce: 'GTC',
        });
      }

      if (this.onTradeFillCallback) {
        this.onTradeFillCallback(fillRes.tradeRecord);
      }
    }
  }

  // End of trading day sequence
  private concludeTradingDay() {
    const priceMap = this.pricingEngine.getPriceMap();
    const risk = this.portfolioEngine.calculateRiskMetrics(COMPANY_MAP);

    // Apply overnight financing (margin cash interest, short borrow fees)
    this.portfolioEngine.applyOvernightFinancing(COMPANY_MAP);

    // Update rival portfolios
    this.rivalEngine.updateDaily(this.companies, priceMap, this.simDay);

    // Process scheduled earnings for today
    const earningsToday = this.upcomingEarnings.filter(e => e.simDay === this.simDay);
    for (const earn of earningsToday) {
      if (earn.ticker) {
        this.activeJumpDeltas.set(earn.ticker, earn.trueImpact);
        this.activeNews.unshift(earn);
      }
    }

    // Cancel unfilled DAY orders
    for (const [id, order] of this.openOrders.entries()) {
      if (order.timeInForce === 'DAY' && isValidPendingOrder(order)) {
        order.status = 'cancelled';
        this.openOrders.delete(id);
      }
    }

    // Generate End of Day Coach Report
    const history = this.portfolioEngine.getTradeHistory();
    const todaysTrades = history.filter(t => Date.now() - t.timestamp < 3600000);
    let bestTrade: TradeRecord | undefined;
    let worstTrade: TradeRecord | undefined;

    for (const t of todaysTrades) {
      if (t.realizedPnl !== undefined) {
        if (!bestTrade || t.realizedPnl > (bestTrade.realizedPnl || -Infinity)) bestTrade = t;
        if (!worstTrade || t.realizedPnl < (worstTrade.realizedPnl || Infinity)) worstTrade = t;
      }
    }

    // Coach note evaluation
    let coachNote = 'Disciplined execution today. Capital preserved and risk exposure stayed balanced.';
    if (risk.largestPositionPercent > 40) {
      coachNote = `You held ${risk.largestPositionPercent}% in a single stock (${risk.largestPositionTicker}). A single shock in that name poses excessive portfolio drawdown risk.`;
    } else if (risk.grossLeverage > 1.8) {
      coachNote = 'Leverage reached near maximum permitted limits. Keep excess margin cushions for overnight volatility.';
    }

    const report: EndOfDayReport = {
      day: this.simDay,
      dateStr: `Sim Day ${this.simDay}`,
      startingEquity: 100000,
      endingEquity: risk.netLiquidationValue,
      netPnl: risk.netLiquidationValue - 100000,
      returnPct: Math.round(((risk.netLiquidationValue - 100000) / 100000) * 1000) / 10,
      bestTrade,
      worstTrade,
      coachNote,
      sectorAttribution: risk.sectorExposures.map(s => ({ sector: s.sector, pnl: s.dollarValue * 0.02 })),
    };

    this.eodReports.push(report);
    this.currentEodModal = report;

    // Reset clock for next trading day
    this.simDay += 1;
    this.actionSeq += 1;
    this.simSecondsOfDay = 9.5 * 3600; // 09:30:00
    this.pricingEngine.startNewDay(Math.floor(Date.now() / 1000));
    this.portfolioEngine.resetDayStartEquity(risk.netLiquidationValue);
  }

  dismissEodModal() {
    this.currentEodModal = null;
  }

  getCurrentEodModal(): EndOfDayReport | null {
    return this.currentEodModal;
  }

  skipToNextDay() {
    this.concludeTradingDay();
  }

  // Composite snapshot for UI panels
  getSnapshot(): MarketSnapshot {
    const priceMap = this.pricingEngine.getPriceMap();
    const risk = this.portfolioEngine.calculateRiskMetrics(COMPANY_MAP);

    // Compute TAPE50 index
    let totalCap = 0;
    let baseCap = 0;
    for (const comp of this.companies) {
      const curPrice = priceMap.get(comp.ticker) || comp.initialPrice;
      totalCap += curPrice * comp.sharesFloat;
      baseCap += comp.initialPrice * comp.sharesFloat;
    }
    const tape50Value = Math.round((totalCap / baseCap) * 5000 * 100) / 100;
    const tape50Change = Math.round((tape50Value - 5000) * 100) / 100;
    const tape50Pct = Math.round((tape50Change / 5000) * 10000) / 100;

    const tape50: MarketIndex = {
      symbol: 'TAPE50',
      name: 'TAPE 50 Composite Index',
      value: tape50Value,
      change: tape50Change,
      changePercent: tape50Pct,
    };

    // Compute sector indices
    const sectorIndices: MarketIndex[] = SECTORS.map(sec => {
      const secComps = this.companies.filter(c => c.sector === sec);
      let sCur = 0;
      let sBase = 0;
      for (const sc of secComps) {
        const curP = priceMap.get(sc.ticker) || sc.initialPrice;
        sCur += curP * sc.sharesFloat;
        sBase += sc.initialPrice * sc.sharesFloat;
      }
      const val = Math.round((sCur / sBase) * 1000 * 100) / 100;
      const chg = Math.round((val - 1000) * 100) / 100;
      return {
        symbol: sec.substring(0, 4).toUpperCase(),
        name: `${sec} Index`,
        value: val,
        change: chg,
        changePercent: Math.round((chg / 1000) * 10000) / 100,
      };
    });

    const prices = this.pricingEngine.getAllStates().map(s => ({
      ticker: s.ticker,
      price: s.price,
      change: s.change,
      changePercent: s.changePercent,
      volume: s.volume,
      direction: s.lastTickDirection,
      lastMoveDirection: s.lastMoveDirection || 'up',
      high: s.highPrice,
      low: s.lowPrice,
      vwap: s.vwap,
    }));

    // Format sim time string "HH:MM:SS"
    const totalSec = Math.floor(this.simSecondsOfDay);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const simTimeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    return {
      simDay: this.simDay,
      simTimeStr,
      session: this.session,
      regime: this.pricingEngine.getRegime(),
      tape50,
      sectorIndices,
      prices,
      riskMetrics: risk,
      positions: this.portfolioEngine.getPositions(),
      openOrders: Array.from(this.openOrders.values()),
      recentTrades: this.portfolioEngine.getTradeHistory().slice(0, 50),
      activeNews: this.activeNews,
      upcomingEarnings: this.upcomingEarnings.filter(e => e.simDay >= this.simDay).slice(0, 15),
      rivals: this.rivalEngine.getRivals(),
      career: {
        rank: this.careerEngine.getCurrentRank(),
        nextRank: this.careerEngine.getNextRank(),
        reputation: this.careerEngine.getReputation(),
        riskBreaches: this.careerEngine.getRiskBreaches(),
        objectives: this.careerEngine.getObjectives(),
        achievements: this.careerEngine.getAchievements(),
      },
    };
  }

  // Access depth for a specific stock
  getDepth(ticker: string): OrderBookDepth | undefined {
    return this.depthCache.get(ticker);
  }

  // Access candles for chart
  getCandles(ticker: string, timeframe: '1m' | '5m' | '15m' | '1h' | '1D'): Candle[] {
    const s = this.pricingEngine.getState(ticker);
    if (!s) return [];
    if (timeframe === '1m') return s.candles1m;
    if (timeframe === '5m') return s.candles5m;
    if (timeframe === '15m') return s.candles15m;
    if (timeframe === '1h') return s.candles1h;
    return s.candles1D;
  }
}
