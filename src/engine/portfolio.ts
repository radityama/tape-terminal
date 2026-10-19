import { Company, Sector, SECTORS } from '../data/companies';
import { Money } from '../lib/money';
import { EquityAssetClass } from './assets/equity';
import { OrderSide, TradeRecord, validOrderValue } from './matching';

export interface Position {
  ticker: string;
  shares: number; // positive for long, negative for short
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number; // abs(shares) * currentPrice
  costBasis: number; // abs(shares) * averageEntryPrice
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTimestamp: number;
  borrowFeeAccumulated: number;
  initialStopPrice?: number;
}

export interface SectorExposure {
  sector: Sector;
  dollarValue: number;
  percentageOfEquity: number;
}

export interface RiskMetrics {
  netLiquidationValue: number;
  cashBalance: number;
  totalMarketExposure: number; // sum of abs(marketValue)
  grossLeverage: number; // totalMarketExposure / netLiquidationValue
  buyingPower: number;
  marginUsed: number;
  maintenanceMarginRequirement: number;
  marginCushionPercent: number; // (Equity - MaintMargin) / MaintMargin
  isMarginWarning: boolean; // Cushion <= 35%
  isMarginBreached: boolean; // Cushion <= 0%
  betaWeightedExposure: number; // aggregate portfolio dollar beta vs TAPE50
  portfolioBeta: number;
  largestPositionPercent: number;
  largestPositionTicker: string;
  oneDayParametricVaR: number; // 95% 1-day parametric VaR
  sectorExposures: SectorExposure[];
}

export interface PortfolioEngineState {
  cash: string;
  startingCapital: string;
  positions: Position[];
  tradeHistory: TradeRecord[];
  marginUnlocked: boolean;
  shortingUnlocked: boolean;
  dayStartEquity: string;
  peakEquity: string;
  maxDrawdownPercent: number;
}

export class PortfolioEngine {
  private cash: Money;
  private startingCapital: Money;
  private positions: Map<string, Position>;
  private tradeHistory: TradeRecord[];
  private marginUnlocked: boolean;
  private shortingUnlocked: boolean;
  private dayStartEquity: Money;
  private peakEquity: Money;
  private maxDrawdownPercent: number = 0;

  constructor(
    startingBalance: number = 100000,
    marginUnlocked: boolean = false,
    shortingUnlocked: boolean = false
  ) {
    this.cash = Money.from(startingBalance);
    this.startingCapital = Money.from(startingBalance);
    this.positions = new Map<string, Position>();
    this.tradeHistory = [];
    this.marginUnlocked = marginUnlocked;
    this.shortingUnlocked = shortingUnlocked;
    this.dayStartEquity = Money.from(startingBalance);
    this.peakEquity = Money.from(startingBalance);
  }

  exportState(): PortfolioEngineState {
    return {
      cash: this.cash.toString(),
      startingCapital: this.startingCapital.toString(),
      positions: this.getPositions().map((p) => ({ ...p })),
      tradeHistory: this.tradeHistory.map((t) => ({ ...t })),
      marginUnlocked: this.marginUnlocked,
      shortingUnlocked: this.shortingUnlocked,
      dayStartEquity: this.dayStartEquity.toString(),
      peakEquity: this.peakEquity.toString(),
      maxDrawdownPercent: this.maxDrawdownPercent,
    };
  }

  importState(state: PortfolioEngineState) {
    this.cash = Money.from(state.cash);
    this.startingCapital = Money.from(state.startingCapital);
    this.positions = new Map(state.positions.map((p) => [p.ticker, { ...p }]));
    this.tradeHistory = state.tradeHistory.map((t) => ({ ...t }));
    this.marginUnlocked = state.marginUnlocked;
    this.shortingUnlocked = state.shortingUnlocked;
    this.dayStartEquity = Money.from(state.dayStartEquity);
    this.peakEquity = Money.from(state.peakEquity);
    this.maxDrawdownPercent = state.maxDrawdownPercent;
  }

  getCash(): number {
    return this.cash.toNumber();
  }

  getBuyingPower(): number {
    let longValue = 0;
    let shortValue = 0;
    for (const position of this.positions.values()) {
      if (position.shares > 0) longValue += position.marketValue;
      else shortValue += position.marketValue;
    }
    if (!this.marginUnlocked) return Math.round(Math.max(0, this.getCash() - shortValue) * 100) / 100;
    return Math.round(Math.max(0, this.marginBuyingPower(this.getCash(), longValue, shortValue)) * 100) / 100;
  }

  // Shared by the displayed buying power and the pre-fill margin check so the two cannot diverge.
  private marginBuyingPower(cash: number, longValue: number, shortValue: number): number {
    const equity = Math.round((cash + longValue - shortValue) * 100) / 100;
    return Math.round((2 * equity - longValue - shortValue) * 100) / 100;
  }

  isMarginUnlocked(): boolean {
    return this.marginUnlocked;
  }

  getStartingCapital(): number {
    return this.startingCapital.toNumber();
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(ticker: string): Position | undefined {
    return this.positions.get(ticker);
  }

  getTradeHistory(): TradeRecord[] {
    return this.tradeHistory;
  }

  setUnlockedFeatures(margin: boolean, shorting: boolean) {
    this.marginUnlocked = margin;
    this.shortingUnlocked = shorting;
  }

  resetDayStartEquity(currentEquity: number) {
    this.dayStartEquity = Money.from(currentEquity);
  }

  // Update mark-to-market prices for all open positions
  updateMarketPrices(priceMap: Map<string, number>) {
    for (const [ticker, pos] of this.positions.entries()) {
      const p = priceMap.get(ticker);
      if (p !== undefined && p > 0) {
        pos.currentPrice = p;
        const totalValue = Math.abs(pos.shares) * p;
        pos.marketValue = Math.round(totalValue * 100) / 100;

        if (pos.shares > 0) {
          // Long position
          pos.unrealizedPnl = Math.round((pos.marketValue - pos.costBasis) * 100) / 100;
          pos.unrealizedPnlPercent = pos.costBasis > 0 ? (pos.unrealizedPnl / pos.costBasis) * 100 : 0;
        } else {
          // Short position
          pos.unrealizedPnl = Math.round((pos.costBasis - pos.marketValue) * 100) / 100;
          pos.unrealizedPnlPercent = pos.costBasis > 0 ? (pos.unrealizedPnl / pos.costBasis) * 100 : 0;
        }
      }
    }
  }

  // Execute fill on the portfolio
  executeFill(
    trade: {
      orderId: string;
      ticker: string;
      side: OrderSide;
      shares: number;
      price: number;
      commission: number;
      slippageDollars: number;
      timestamp: number;
      initialStopPrice?: number;
    }
  ): { success: boolean; error?: string; tradeRecord?: TradeRecord } {
    const { ticker, side, shares, price, commission, timestamp, orderId, slippageDollars, initialStopPrice } = trade;
    const error = this.checkFill(trade);
    if (error) return { success: false, error };
    const existing = this.positions.get(ticker);
    const notional = shares * price;

    let isClosingTrade = false;
    let realizedPnl: number | undefined;
    let holdingTimeMinutes: number | undefined;
    let rMultiple: number | undefined;

    // Commission is always deducted from cash
    this.cash = this.cash.sub(commission);

    if (!existing) {
      // Opening brand new position
      if (side === 'buy') {
        this.cash = this.cash.sub(notional);
        this.positions.set(ticker, {
          ticker,
          shares,
          averageEntryPrice: price,
          currentPrice: price,
          marketValue: notional,
          costBasis: notional,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTimestamp: timestamp,
          borrowFeeAccumulated: 0,
          initialStopPrice,
        });
      } else {
        // Opening short position: receive short sale proceeds as credit
        this.cash = this.cash.add(notional);
        this.positions.set(ticker, {
          ticker,
          shares: -shares,
          averageEntryPrice: price,
          currentPrice: price,
          marketValue: notional,
          costBasis: notional,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTimestamp: timestamp,
          borrowFeeAccumulated: 0,
          initialStopPrice,
        });
      }
    } else {
      // Existing position exists
      const currentShares = existing.shares;

      if ((currentShares > 0 && side === 'buy') || (currentShares < 0 && side === 'sell')) {
        // Adding to existing position (same direction)
        const additionalNotional = notional;
        const newTotalShares = currentShares > 0 ? currentShares + shares : currentShares - shares;
        const newCostBasis = existing.costBasis + additionalNotional;
        const newAvgEntry = newCostBasis / Math.abs(newTotalShares);

        if (side === 'buy') {
          this.cash = this.cash.sub(notional);
        } else {
          this.cash = this.cash.add(notional);
        }

        existing.shares = newTotalShares;
        existing.averageEntryPrice = Math.round(newAvgEntry * 100) / 100;
        existing.costBasis = Math.round(newCostBasis * 100) / 100;
        existing.currentPrice = price;
        existing.marketValue = Math.round(Math.abs(newTotalShares) * price * 100) / 100;
      } else {
        // Reducing or flipping existing position (opposite direction)
        isClosingTrade = true;
        const sharesToClose = Math.min(Math.abs(currentShares), shares);
        const fractionClosed = sharesToClose / Math.abs(currentShares);

        if (currentShares > 0) {
          // Closing long shares: receiving cash
          this.cash = this.cash.add(sharesToClose * price);
          realizedPnl = (price - existing.averageEntryPrice) * sharesToClose;
        } else {
          // Covering short shares: paying cash
          this.cash = this.cash.sub(sharesToClose * price);
          realizedPnl = (existing.averageEntryPrice - price) * sharesToClose;
        }

        // Calculate holding time
        holdingTimeMinutes = Math.max(1, Math.round((timestamp - existing.entryTimestamp) / 60000));

        // Calculate R-multiple if stop was specified
        if (existing.initialStopPrice && existing.initialStopPrice > 0) {
          const initialRisk = Math.abs(existing.averageEntryPrice - existing.initialStopPrice);
          if (initialRisk > 0.01) {
            rMultiple = Math.round(((realizedPnl / sharesToClose) / initialRisk) * 10) / 10;
          }
        }

        const remainingShares = Math.abs(currentShares) - sharesToClose;
        if (remainingShares === 0) {
          // If the order size was larger than existing position, flip into reverse side
          const excessShares = shares - sharesToClose;
          this.positions.delete(ticker);

          if (excessShares > 0) {
            if (side === 'buy') {
              // Flipped to long
              this.cash = this.cash.sub(excessShares * price);
              this.positions.set(ticker, {
                ticker,
                shares: excessShares,
                averageEntryPrice: price,
                currentPrice: price,
                marketValue: excessShares * price,
                costBasis: excessShares * price,
                unrealizedPnl: 0,
                unrealizedPnlPercent: 0,
                entryTimestamp: timestamp,
                borrowFeeAccumulated: 0,
                initialStopPrice,
              });
            } else {
              // Flipped to short
              this.cash = this.cash.add(excessShares * price);
              this.positions.set(ticker, {
                ticker,
                shares: -excessShares,
                averageEntryPrice: price,
                currentPrice: price,
                marketValue: excessShares * price,
                costBasis: excessShares * price,
                unrealizedPnl: 0,
                unrealizedPnlPercent: 0,
                entryTimestamp: timestamp,
                borrowFeeAccumulated: 0,
                initialStopPrice,
              });
            }
          }
        } else {
          // Partial close
          const newShares = currentShares > 0 ? remainingShares : -remainingShares;
          existing.shares = newShares;
          existing.costBasis = Math.round(existing.costBasis * (1 - fractionClosed) * 100) / 100;
          existing.marketValue = Math.round(remainingShares * price * 100) / 100;
        }
      }
    }

    this.updateMarketPrices(new Map([[ticker, price]]));

    const tradeRecord: TradeRecord = {
      id: `trade_${timestamp}_${Math.random().toString(36).substring(2, 6)}`,
      orderId,
      ticker,
      side,
      shares,
      price,
      totalValue: Math.round(notional * 100) / 100,
      commission,
      slippageDollars,
      timestamp,
      isClosingTrade,
      realizedPnl: realizedPnl !== undefined ? Math.round(realizedPnl * 100) / 100 : undefined,
      holdingTimeMinutes,
      rMultiple,
    };

    this.tradeHistory.unshift(tradeRecord);
    return { success: true, tradeRecord };
  }

  checkFill(trade: Parameters<PortfolioEngine['executeFill']>[0]): string | null {
    const { ticker, side, shares, price, commission, slippageDollars, initialStopPrice } = trade;
    if (!validOrderValue(shares, price)
      || !Number.isFinite(commission) || commission < 0 || !Number.isSafeInteger(Math.round(commission * 100))
      || !Number.isFinite(slippageDollars) || slippageDollars < 0 || !Number.isSafeInteger(Math.round(slippageDollars * 100))
      || (initialStopPrice !== undefined && !validOrderValue(shares, initialStopPrice))) {
      return 'Invalid fill quantity or price.';
    }
    const existing = this.positions.get(ticker);
    const notional = shares * price;
    if (side === 'sell' && !this.shortingUnlocked && shares > Math.max(existing?.shares ?? 0, 0)) {
      return 'Short selling unlocks at Rank 2 (Junior Trader).';
    }
    if (side === 'sell' && !this.marginUnlocked && shares > Math.max(0, existing?.shares ?? 0)) {
      let shortValue = Math.max(0, shares - (existing?.shares ?? 0)) * price;
      for (const position of this.positions.values()) {
        if (position.ticker !== ticker && position.shares < 0) shortValue += position.marketValue;
      }
      if (Math.round((this.getCash() + notional - commission - shortValue) * 100) < 0) {
        return 'Insufficient buying power.';
      }
    }
    if (side === 'buy' && shares > Math.max(0, -(existing?.shares ?? 0))) {
      const cashAfter = this.getCash() - notional - commission;
      if (!this.marginUnlocked) {
        let shortValue = Math.max(0, -((existing?.shares ?? 0) + shares)) * price;
        for (const position of this.positions.values()) {
          if (position.ticker !== ticker && position.shares < 0) shortValue += position.marketValue;
        }
        if (Math.round((cashAfter - shortValue) * 100) < 0) {
          return 'Insufficient buying power.';
        }
      }
    }
    if (this.marginUnlocked && (side === 'buy'
      ? shares > Math.max(0, -(existing?.shares ?? 0))
      : shares > Math.max(0, existing?.shares ?? 0))) {
      const cashAfter = this.getCash() + (side === 'buy' ? -notional : notional) - commission;
      const projectedShares = (existing?.shares ?? 0) + (side === 'buy' ? shares : -shares);
      let longValue = Math.max(0, projectedShares) * price;
      let shortValue = Math.max(0, -projectedShares) * price;
      for (const position of this.positions.values()) {
        if (position.ticker === ticker) continue;
        if (position.shares > 0) longValue += position.marketValue;
        else shortValue += position.marketValue;
      }
      if (this.marginBuyingPower(cashAfter, longValue, shortValue) < 0) {
        return 'Insufficient buying power.';
      }
    }
    return null;
  }

  // Daily overnight fees: margin cash interest (if cash is negative) and short borrow fees
  applyOvernightFinancing(companyMap: Map<string, Company>) {
    // 1. Margin cash borrow interest (if cash < 0)
    if (this.cash.isNegative()) {
      const dailyRate = 0.08 / 360; // 8% annualized broker borrow rate
      const interest = Math.abs(this.cash.toNumber()) * dailyRate;
      this.cash = this.cash.sub(interest);
    }

    // 2. Short borrow fee per position
    for (const pos of this.positions.values()) {
      if (pos.shares < 0) {
        const comp = companyMap.get(pos.ticker);
        const rate = comp ? comp.borrowCostRate : EquityAssetClass.marginRules.borrowFeeAnnualRate;
        const dailyFee = (pos.marketValue * rate) / 360;
        pos.borrowFeeAccumulated += dailyFee;
        this.cash = this.cash.sub(dailyFee);
      }
    }
  }

  // Calculate comprehensive live risk metrics
  calculateRiskMetrics(companyMap: Map<string, Company>): RiskMetrics {
    let totalLongValue = 0;
    let totalShortValue = 0;
    let weightedBetaSum = 0;

    const sectorValues = new Map<Sector, number>();
    for (const s of SECTORS) sectorValues.set(s, 0);

    let largestPositionVal = 0;
    let largestPositionTicker = '';

    for (const pos of this.positions.values()) {
      const comp = companyMap.get(pos.ticker);
      const beta = comp ? comp.beta : 1.0;
      const sector = comp ? comp.sector : 'Technology';

      if (pos.shares > 0) {
        totalLongValue += pos.marketValue;
        weightedBetaSum += pos.marketValue * beta;
      } else {
        totalShortValue += pos.marketValue;
        weightedBetaSum -= pos.marketValue * beta; // short reduces positive market beta
      }

      // Sector aggregation
      const curSectorVal = sectorValues.get(sector) || 0;
      sectorValues.set(sector, curSectorVal + pos.marketValue);

      // Track largest exposure
      if (pos.marketValue > largestPositionVal) {
        largestPositionVal = pos.marketValue;
        largestPositionTicker = pos.ticker;
      }
    }

    const netLiquidationValue = Math.round((this.cash.toNumber() + totalLongValue - totalShortValue) * 100) / 100;
    const totalMarketExposure = Math.round((totalLongValue + totalShortValue) * 100) / 100;

    // Margin maintenance requirement: 25% of gross market exposure
    const maintenanceRequirement = this.marginUnlocked ? totalMarketExposure * 0.25 : totalMarketExposure;
    const marginUsed = this.marginUnlocked ? totalMarketExposure * 0.50 : totalMarketExposure;

    // Available Buying Power:
    // With margin unlocked: max(0, 2 * max(0, NetLiquidation - totalMarketExposure * 0.5))
    // Without margin: cash less the marked liability securing any short positions.
    const buyingPower = this.getBuyingPower();

    // Cushion = (NetLiquidation - MaintenanceRequirement) / max(1, MaintenanceRequirement)
    let marginCushionPercent = 100;
    let isMarginWarning = false;
    let isMarginBreached = false;

    if (maintenanceRequirement > 0 && this.marginUnlocked) {
      marginCushionPercent = Math.round(((netLiquidationValue - maintenanceRequirement) / maintenanceRequirement) * 1000) / 10;
      if (marginCushionPercent <= 35) {
        isMarginWarning = true;
      }
      if (marginCushionPercent <= 0) {
        isMarginBreached = true;
      }
    }

    // High water mark and drawdown
    if (netLiquidationValue > this.peakEquity.toNumber()) {
      this.peakEquity = Money.from(netLiquidationValue);
    }
    const peak = this.peakEquity.toNumber();
    if (peak > 0) {
      const dd = ((peak - netLiquidationValue) / peak) * 100;
      if (dd > this.maxDrawdownPercent) {
        this.maxDrawdownPercent = Math.round(dd * 10) / 10;
      }
    }

    // 1-Day Parametric Value at Risk (95% confidence level, z = 1.645)
    // VaR = 1.645 * PortfolioValue * (vol / sqrt(252))
    const portfolioVol = 0.20; // baseline portfolio annual volatility
    const oneDayVol = portfolioVol / Math.sqrt(252);
    const oneDayParametricVaR = Math.round(totalMarketExposure * 1.645 * oneDayVol * 100) / 100;

    const sectorExposures: SectorExposure[] = SECTORS.map(s => {
      const val = sectorValues.get(s) || 0;
      const pct = netLiquidationValue > 0 ? (val / netLiquidationValue) * 100 : 0;
      return {
        sector: s,
        dollarValue: Math.round(val * 100) / 100,
        percentageOfEquity: Math.round(pct * 10) / 10,
      };
    });

    const portfolioBeta = totalMarketExposure > 0 ? Math.round((weightedBetaSum / totalMarketExposure) * 100) / 100 : 0;
    const largestPositionPercent = netLiquidationValue > 0 ? Math.round((largestPositionVal / netLiquidationValue) * 1000) / 10 : 0;

    return {
      netLiquidationValue,
      cashBalance: Math.round(this.cash.toNumber() * 100) / 100,
      totalMarketExposure,
      grossLeverage: netLiquidationValue > 0 ? Math.round((totalMarketExposure / netLiquidationValue) * 100) / 100 : 0,
      buyingPower,
      marginUsed: Math.round(marginUsed * 100) / 100,
      maintenanceMarginRequirement: Math.round(maintenanceRequirement * 100) / 100,
      marginCushionPercent,
      isMarginWarning,
      isMarginBreached,
      betaWeightedExposure: Math.round(weightedBetaSum * 100) / 100,
      portfolioBeta,
      largestPositionPercent,
      largestPositionTicker,
      oneDayParametricVaR,
      sectorExposures,
    };
  }

  // Liquidate largest loser when margin is breached
  liquidateLargestLoser(
    priceMap: Map<string, number>,
    timestamp: number
  ): { liquidatedTicker: string; realizedLoss: number; explanation: string } | null {
    if (this.positions.size === 0) return null;

    let worstTicker = '';
    let worstPnl = Infinity;

    for (const [ticker, pos] of this.positions.entries()) {
      if (pos.unrealizedPnl < worstPnl) {
        worstPnl = pos.unrealizedPnl;
        worstTicker = ticker;
      }
    }

    if (!worstTicker) {
      worstTicker = Array.from(this.positions.keys())[0];
    }

    const pos = this.positions.get(worstTicker)!;
    const currentPrice = priceMap.get(worstTicker) || pos.currentPrice;
    const sharesToLiquidate = Math.abs(pos.shares);
    const side: OrderSide = pos.shares > 0 ? 'sell' : 'buy';

    this.executeFill({
      orderId: `liq_${timestamp}`,
      ticker: worstTicker,
      side,
      shares: sharesToLiquidate,
      price: currentPrice,
      commission: 2.0,
      slippageDollars: 0.05,
      timestamp,
    });

    return {
      liquidatedTicker: worstTicker,
      realizedLoss: worstPnl,
      explanation: `Margin maintenance requirement breached. Broker liquidated ${sharesToLiquidate} shares of ${worstTicker} to protect account solvency.`,
    };
  }
}
