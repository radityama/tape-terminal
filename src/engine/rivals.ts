import { Company } from '../data/companies';
import { SeededRNG } from './rng';

export type RivalStyle = 
  | 'Momentum Breakout' 
  | 'Deep Value' 
  | 'Contrarian Reversal' 
  | 'News Scalper' 
  | 'Overleveraged Degenerate' 
  | 'Index Hugger' 
  | 'Mean Reversion' 
  | 'Quantitative Volatility';

export interface RivalTrader {
  id: string;
  name: string;
  firm: string;
  style: RivalStyle;
  bio: string;
  initialCapital: number;
  currentEquity: number;
  totalPnl: number;
  totalReturnPct: number;
  sharpeRatio: number;
  winRate: number;
  currentHoldings: Array<{ ticker: string; shares: number; weightPct: number }>;
}

export interface RivalEngineState {
  rivals: RivalTrader[];
}

export class RivalEngine {
  private rivals: RivalTrader[];
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
    this.rivals = [
      {
        id: 'rival_1',
        name: 'Elena Rostova',
        firm: 'Vanguard Alpha Desk',
        style: 'Momentum Breakout',
        bio: 'Former track athlete turned execution trader. Buys stocks breaking 20-day highs with high relative volume, cuts losers aggressively.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.45,
        winRate: 0.44,
        currentHoldings: [],
      },
      {
        id: 'rival_2',
        name: 'Marcus Thorne',
        firm: 'Brampton Capital Partners',
        style: 'Deep Value',
        bio: 'Old-school balance sheet analyst. Hunts low P/E, high dividend yields, and depressed enterprise values.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.15,
        winRate: 0.58,
        currentHoldings: [],
      },
      {
        id: 'rival_3',
        name: 'Akihiro Sato',
        firm: 'Kuroshio Quantitative',
        style: 'Mean Reversion',
        bio: 'Trades statistical pairs and RSI divergence. Enters when equities stretch beyond two standard deviations from their 50-day moving average.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.62,
        winRate: 0.65,
        currentHoldings: [],
      },
      {
        id: 'rival_4',
        name: 'Tariq Al-Mansoor',
        firm: 'Levant Prop Desk',
        style: 'News Scalper',
        bio: 'Rapid order typist watching wires and earnings releases. Enters pre-market gap moves and dumps into midday retail flow.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.28,
        winRate: 0.52,
        currentHoldings: [],
      },
      {
        id: 'rival_5',
        name: 'Jaxson Reed',
        firm: 'Apex Retail Speculators',
        style: 'Overleveraged Degenerate',
        bio: 'Trades maximum margin on high-short-interest small caps. Prone to massive +40% days and catastrophic margin calls.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 0.65,
        winRate: 0.38,
        currentHoldings: [],
      },
      {
        id: 'rival_6',
        name: 'Claire Beauchamp',
        firm: 'Geneva Asset Management',
        style: 'Index Hugger',
        bio: 'Strict low tracking-error manager allocating across TAPE50 sector weights with small quarterly rebalancing tilts.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.05,
        winRate: 0.51,
        currentHoldings: [],
      },
      {
        id: 'rival_7',
        name: 'Devin O\'Connor',
        firm: 'Celtic Shore Capital',
        style: 'Contrarian Reversal',
        bio: 'Fades prevailing panic headlines. Buys high-quality companies when black swans strike and takes profits when retail gets euphoric.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.35,
        winRate: 0.56,
        currentHoldings: [],
      },
      {
        id: 'rival_8',
        name: 'Priya Narang',
        firm: 'Vayu Algorithmic Systems',
        style: 'Quantitative Volatility',
        bio: 'Engineers statistical arbitrage models measuring sector dispersion and volatility risk premia.',
        initialCapital: 100000,
        currentEquity: 100000,
        totalPnl: 0,
        totalReturnPct: 0,
        sharpeRatio: 1.85,
        winRate: 0.61,
        currentHoldings: [],
      },
    ];
  }

  getRivals(): RivalTrader[] {
    return this.rivals;
  }

  exportState(): RivalEngineState {
    return {
      rivals: this.rivals.map((r) => ({ ...r, currentHoldings: r.currentHoldings.map((h) => ({ ...h })) })),
    };
  }

  importState(state: RivalEngineState) {
    this.rivals = state.rivals.map((r) => ({ ...r, currentHoldings: r.currentHoldings.map((h) => ({ ...h })) }));
  }

  // Daily rival portfolio rebalancing and performance update
  updateDaily(
    companies: Company[],
    priceMap: Map<string, number>,
    simDay: number
  ) {
    for (const rival of this.rivals) {
      let dailyDrift = 0;

      switch (rival.style) {
        case 'Momentum Breakout':
          dailyDrift = this.rng.nextGaussian(0.0012, 0.022);
          break;
        case 'Deep Value':
          dailyDrift = this.rng.nextGaussian(0.0006, 0.012);
          break;
        case 'Mean Reversion':
          dailyDrift = this.rng.nextGaussian(0.0009, 0.010);
          break;
        case 'News Scalper':
          dailyDrift = this.rng.nextGaussian(0.0010, 0.025);
          break;
        case 'Overleveraged Degenerate':
          // Wild swings, occasional huge win or huge loss
          dailyDrift = this.rng.nextGaussian(0.0005, 0.048);
          break;
        case 'Index Hugger':
          dailyDrift = this.rng.nextGaussian(0.0004, 0.009);
          break;
        case 'Contrarian Reversal':
          dailyDrift = this.rng.nextGaussian(0.0008, 0.016);
          break;
        case 'Quantitative Volatility':
          dailyDrift = this.rng.nextGaussian(0.0011, 0.008);
          break;
      }

      const newEquity = Math.max(10000, rival.currentEquity * (1 + dailyDrift));
      rival.currentEquity = Math.round(newEquity * 100) / 100;
      rival.totalPnl = Math.round((rival.currentEquity - rival.initialCapital) * 100) / 100;
      rival.totalReturnPct = Math.round(((rival.currentEquity - rival.initialCapital) / rival.initialCapital) * 1000) / 10;

      // Update holdings sample periodically
      if (rival.currentHoldings.length === 0 || simDay % 5 === 0) {
        const sampleCount = 3;
        const shuffled = [...companies].sort(() => this.rng.next() - 0.5);
        rival.currentHoldings = shuffled.slice(0, sampleCount).map(c => {
          const p = priceMap.get(c.ticker) || c.initialPrice;
          const alloc = (rival.currentEquity * 0.25);
          const shares = Math.floor(alloc / p);
          return {
            ticker: c.ticker,
            shares,
            weightPct: 25.0,
          };
        });
      }
    }
  }
}
