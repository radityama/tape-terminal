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
    // A restored save may predate weekly tracking or have been paused on a later week.
    this.careerEngine.syncObjectives(this.simDay);
    this.careerEngine.evaluateSectors(this.currentSectors());
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

    // Limit prices cap the commitment; stops and market orders use the current quote.
    const reservePrice = (params.type === 'limit' || params.type === 'stop_limit')
      ? params.limitPrice! : estFill.averagePrice;
    const coveredShares = new Map<string, number>();
    const available = Math.max(0, this.portfolioEngine.getBuyingPower() - this.reservedBuyingPower(undefined, coveredShares));
    const requiredCapital = params.side === 'buy'
      ? this.buyCapital(params.ticker, params.quantity, reservePrice, coveredShares.get(params.ticker) ?? 0) : 0;

    if (params.side === 'buy' && Math.round(requiredCapital * 100) > Math.round(available * 100)) {
      return {
        success: false,
        error: `Insufficient buying power: need $${requiredCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, have $${available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
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
    if (!order || !this.isLiveOrder(order)) return false;

    // Cancelling a bracket parent abandons both exit legs with it. Cancelling one
    // child leaves its OCO sibling active, which is the point of an OCO pair.
    for (const child of [...this.openOrders.values()]) {
      if (child.isBracketChild && child.parentOrderId === orderId
        && child.ticker === order.ticker && this.isLiveOrder(child)) {
        this.cancelOpenOrder(child);
      }
    }
    this.cancelOpenOrder(order);
    this.actionSeq += 1;
    return true;
  }

  // A tick iteration holds object references, so an order cancelled earlier in the same
  // pass must be checked against the live map before it is allowed to fill.
  private isLiveOrder(order: Order): boolean {
    return (order.status === 'pending' || order.status === 'partially_filled')
      && this.openOrders.get(order.id) === order;
  }

  private cancelOpenOrder(order: Order) {
    order.status = 'cancelled';
    this.openOrders.delete(order.id);
  }

  private buyCapital(ticker: string, shares: number, price: number, coveredShares = 0): number {
    const position = this.portfolioEngine.getPosition(ticker);
    const shortShares = Math.max(0, -(position?.shares ?? 0) - coveredShares);
    const openingShares = Math.max(0, shares - shortShares);
    if (!openingShares) return 0;
    const fee = this.matchingEngine.calculateCommission(shares, price);
    const cover = shares - openingShares;
    const coverAdjustment = cover && position ? cover * (this.portfolioEngine.isMarginUnlocked()
      ? 2 * price - 3 * position.currentPrice : price - position.currentPrice) : 0;
    return Math.round(Math.max(0, openingShares * price + coverAdjustment
      + fee * (this.portfolioEngine.isMarginUnlocked() ? 2 : 1)) * 100) / 100;
  }

  private reservedBuyingPower(before?: Order, coveredShares = new Map<string, number>()): number {
    let reserved = 0;
    for (const order of [...this.openOrders.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      if (order === before) break;
      if (order.side !== 'buy' || !isValidPendingOrder(order)
        || (order.status !== 'pending' && order.status !== 'partially_filled')) continue;
      const shares = order.quantity - order.filledQuantity;
      const depth = this.depthCache.get(order.ticker);
      if (!depth) continue;
      const price = (order.type === 'limit' || order.type === 'stop_limit')
        ? order.limitPrice! : this.bookEngine.simulateFill('buy', shares, depth).averagePrice;
      const alreadyCovered = coveredShares.get(order.ticker) ?? 0;
      reserved += this.buyCapital(order.ticker, shares, price, alreadyCovered);
      coveredShares.set(order.ticker, alreadyCovered + shares);
    }
    return Math.round(reserved * 100) / 100;
  }

  // Step the simulation tick by deltaTimeSec
  tick(realDeltaSeconds: number) {
    // Pausing must not freeze objectives on an old week or ignore carried holdings.
    this.careerEngine.syncObjectives(this.simDay);
    this.careerEngine.evaluateSectors(this.currentSectors());

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

    // Update order book depth caches before matching orders by age across all tickers.
    const priceMap = this.pricingEngine.getPriceMap();
    const regime = this.pricingEngine.getRegime();

    for (const comp of this.companies) {
      const priceState = this.pricingEngine.getState(comp.ticker);
      if (!priceState) continue;

      const depth = this.bookEngine.generateDepth(comp, priceState.price, regime);
      this.depthCache.set(comp.ticker, depth);

    }

    // Mark positions before matching so pending-order funding uses this tick's prices, not the previous mark.
    this.portfolioEngine.updateMarketPrices(priceMap);

    for (const order of [...this.openOrders.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      const depth = this.depthCache.get(order.ticker);
      const priceState = this.pricingEngine.getState(order.ticker);
      if (depth && priceState && this.isLiveOrder(order)) {
        this.evaluateOrder(order, depth, priceState.price);
      }
    }

    // Fills mark the position at its execution price; restore the market mark for the rest of the tick.
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

  private currentSectors(): string[] {
    const sectors = new Set<string>();
    for (const position of this.portfolioEngine.getPositions()) {
      if (!position.shares) continue;
      const company = COMPANY_MAP.get(position.ticker);
      if (company) sectors.add(company.sector);
    }
    return [...sectors];
  }

  private evaluateOrder(order: Order, depth: OrderBookDepth, currentPrice: number) {
    if (!this.isLiveOrder(order)) return;
    const fillResult = this.matchingEngine.evaluatePendingOrder(order, depth, currentPrice);
    if (!fillResult || !fillResult.shouldFill) return;

    const remainingShares = order.quantity - order.filledQuantity;

    // A linked exit may only close the position it was created for. This also protects
    // unlocked-short accounts from a stale or imported oversize leg flipping the book.
    if (order.isBracketChild) {
      const position = this.portfolioEngine.getPosition(order.ticker)?.shares ?? 0;
      const closesPosition = position > 0 ? order.side === 'sell'
        : position < 0 ? order.side === 'buy' : false;
      if (!closesPosition || remainingShares > Math.abs(position)) {
        order.status = 'rejected';
        this.openOrders.delete(order.id);
        this.actionSeq += 1;
        this.reconcileBracketOrders(order.ticker);
        return;
      }
    }

    const commission = this.matchingEngine.calculateCommission(remainingShares, fillResult.fillPrice);
    if (order.side === 'buy') {
      const coveredShares = new Map<string, number>();
      const available = Math.max(0, this.portfolioEngine.getBuyingPower() - this.reservedBuyingPower(order, coveredShares));
      if (Math.round(this.buyCapital(order.ticker, remainingShares, fillResult.fillPrice, coveredShares.get(order.ticker) ?? 0) * 100) > Math.round(available * 100)) {
        if (order.isBracketChild) {
          // Linked exits fail closed: a stale leg must not retry forever.
          order.status = 'rejected';
          this.openOrders.delete(order.id);
          this.actionSeq += 1;
          this.reconcileBracketOrders(order.ticker);
        }
        return; // An independent gap or older reservation keeps the order pending for retry/cancellation.
      }
    }
    const sharesBeforeFill = this.portfolioEngine.getPosition(order.ticker)?.shares ?? 0;
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

    if (!fillRes.success && order.isBracketChild) {
      // A rejected exit has a terminal lifecycle: it is removed without a commission,
      // trade or position mutation so a stale leg cannot retry on every future tick.
      order.status = 'rejected';
      this.openOrders.delete(order.id);
      this.actionSeq += 1;
      this.reconcileBracketOrders(order.ticker);
      return;
    }

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

      this.careerEngine.recordFill({
        orderId: order.id,
        ticker: order.ticker,
        realizedPnl: fillRes.tradeRecord.realizedPnl,
        isClosingTrade: fillRes.tradeRecord.isClosingTrade,
        stopProtected: order.stopLossPrice !== undefined,
        sectors: this.currentSectors(),
      });

      // An exit that completed cancels its OCO sibling before any later order in this
      // tick (including the sibling itself) can be evaluated.
      if (order.isBracketChild) {
        this.cancelOcoSibling(order);
      }

      // Clamp or cancel surviving exits for this ticker before creating new children.
      this.reconcileBracketOrders(order.ticker);

      const sharesAfterFill = this.portfolioEngine.getPosition(order.ticker)?.shares ?? 0;
      if (!order.isBracketChild) {
        this.createBracketChildrenForFill(order, sharesBeforeFill, sharesAfterFill);
      }

      if (this.onTradeFillCallback) {
        this.onTradeFillCallback(fillRes.tradeRecord);
      }
    }
  }

  // Bracket children are exits for exposure opened by the parent. A fill that only
  // closes/reduces an existing position must never attach inverse brackets.
  private createBracketChildrenForFill(order: Order, sharesBefore: number, sharesAfter: number) {
    if (order.takeProfitPrice === undefined && order.stopLossPrice === undefined) return;
    if (order.filledQuantity !== order.quantity) return;

    const openedInOrderDirection = order.side === 'buy'
      ? Math.max(0, sharesAfter) > Math.max(0, sharesBefore)
      : Math.max(0, -sharesAfter) > Math.max(0, -sharesBefore);
    if (!openedInOrderDirection) return;
    if ([...this.openOrders.values()].some((o) => o.isBracketChild && o.parentOrderId === order.id)) return;

    const side: OrderSide = order.side === 'buy' ? 'sell' : 'buy';
    const createdAt = Date.now();
    const children: Order[] = [];

    if (order.takeProfitPrice && order.takeProfitPrice > 0
      && !validateOrderInput({ type: 'limit', quantity: order.quantity, limitPrice: order.takeProfitPrice })) {
      children.push({
        id: `${order.id}_tp`,
        ticker: order.ticker,
        side,
        type: 'limit',
        quantity: order.quantity,
        filledQuantity: 0,
        limitPrice: order.takeProfitPrice,
        timeInForce: 'GTC',
        status: 'pending',
        createdAt,
        commissionPaid: 0,
        parentOrderId: order.id,
        isBracketChild: true,
      });
    }

    if (order.stopLossPrice && order.stopLossPrice > 0
      && !validateOrderInput({ type: 'stop', quantity: order.quantity, stopPrice: order.stopLossPrice })) {
      children.push({
        id: `${order.id}_sl`,
        ticker: order.ticker,
        side,
        type: 'stop',
        quantity: order.quantity,
        filledQuantity: 0,
        stopPrice: order.stopLossPrice,
        timeInForce: 'GTC',
        status: 'pending',
        createdAt,
        commissionPaid: 0,
        parentOrderId: order.id,
        isBracketChild: true,
      });
    }

    for (const child of children) this.openOrders.set(child.id, child);
    if (children.length > 0) this.actionSeq += 1;

    // A parent quantity can include shares that were already closed manually, so the
    // new exits are immediately clamped to the position they are allowed to close.
    this.reconcileBracketOrders(order.ticker);
  }

  // One-cancels-other only applies to explicit siblings of the same bracket parent.
  private cancelOcoSibling(filled: Order) {
    if (!filled.parentOrderId) return;
    for (const sibling of [...this.openOrders.values()]) {
      if (sibling.id === filled.id || !this.isLiveOrder(sibling)) continue;
      if (sibling.isBracketChild && sibling.parentOrderId === filled.parentOrderId
        && sibling.ticker === filled.ticker) {
        this.cancelOpenOrder(sibling);
      }
    }
  }

  // Keep linked exits aligned with the live position. Only bracket children are touched;
  // independent orders on the same ticker keep their own lifecycle.
  private reconcileBracketOrders(ticker: string) {
    const position = this.portfolioEngine.getPosition(ticker)?.shares ?? 0;
    for (const order of [...this.openOrders.values()]) {
      if (order.ticker !== ticker || !order.isBracketChild || !this.isLiveOrder(order)) continue;

      const closesPosition = position > 0 ? order.side === 'sell'
        : position < 0 ? order.side === 'buy' : false;
      if (!closesPosition) {
        this.cancelOpenOrder(order);
        continue;
      }

      const remaining = Math.min(order.quantity - order.filledQuantity, Math.abs(position));
      if (remaining <= 0) {
        this.cancelOpenOrder(order);
      } else {
        order.quantity = order.filledQuantity + remaining;
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
        const position = this.portfolioEngine.getPosition(earn.ticker);
        if (position && position.shares !== 0) this.careerEngine.markEarningsHeld([earn.ticker]);
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
    this.careerEngine.syncObjectives(this.simDay);
    this.careerEngine.evaluateSectors(this.currentSectors());
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
    risk.buyingPower = Math.round(Math.max(0, risk.buyingPower - this.reservedBuyingPower()) * 100) / 100;

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
