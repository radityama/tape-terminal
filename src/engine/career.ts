export type CareerRankId = 
  | 'intern' 
  | 'junior_trader' 
  | 'trader' 
  | 'senior_trader' 
  | 'portfolio_manager' 
  | 'fund_manager';

export interface CareerRankDefinition {
  id: CareerRankId;
  name: string;
  order: number;
  equityTarget: number;
  reputationRequired: number;
  maxDrawdownPercent: number;
  maxSinglePositionPercent: number;
  unlockedFeatures: string[];
  description: string;
}

export interface WeeklyObjective {
  id: string;
  title: string;
  description: string;
  reputationReward: number;
  completed: boolean;
  progressText: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: number;
}

export const CAREER_RANKS: CareerRankDefinition[] = [
  {
    id: 'intern',
    name: 'Intern Trader',
    order: 1,
    equityTarget: 110000,
    reputationRequired: 0,
    maxDrawdownPercent: 15,
    maxSinglePositionPercent: 25,
    unlockedFeatures: ['Cash account', 'Market orders', 'Limit orders', 'Basic Watchlist'],
    description: 'Learn market dynamics, keep position sizing disciplined, and protect your starting principal.',
  },
  {
    id: 'junior_trader',
    name: 'Junior Trader',
    order: 2,
    equityTarget: 135000,
    reputationRequired: 100,
    maxDrawdownPercent: 12,
    maxSinglePositionPercent: 25,
    unlockedFeatures: ['Short selling', 'Stop orders', 'Stop-Limit orders'],
    description: 'Borrow shares to profit from falling prices. Master stop loss discipline.',
  },
  {
    id: 'trader',
    name: 'Trader',
    order: 3,
    equityTarget: 175000,
    reputationRequired: 250,
    maxDrawdownPercent: 12,
    maxSinglePositionPercent: 30,
    unlockedFeatures: ['Margin 2x leverage', 'Trailing stops', 'Bracket orders'],
    description: 'Access borrowed capital to amplify winning trades, while keeping margin cushions safe.',
  },
  {
    id: 'senior_trader',
    name: 'Senior Trader',
    order: 4,
    equityTarget: 240000,
    reputationRequired: 450,
    maxDrawdownPercent: 10,
    maxSinglePositionPercent: 35,
    unlockedFeatures: ['Stock Screener', 'Level 2 Depth Ladder'],
    description: 'Filter the full universe by valuation and momentum. Read depth liquidity before entering.',
  },
  {
    id: 'portfolio_manager',
    name: 'Portfolio Manager',
    order: 5,
    equityTarget: 350000,
    reputationRequired: 700,
    maxDrawdownPercent: 8,
    maxSinglePositionPercent: 40,
    unlockedFeatures: ['Rival Portfolio Analytics', 'Parametric VaR decomposition'],
    description: 'Lead institutional capital. Benchmark performance against the TAPE50 index.',
  },
  {
    id: 'fund_manager',
    name: 'Fund Manager',
    order: 6,
    equityTarget: 500000,
    reputationRequired: 1000,
    maxDrawdownPercent: 8,
    maxSinglePositionPercent: 50,
    unlockedFeatures: ['Master Terminal Status', 'All tools unlocked'],
    description: 'Elite market practitioner with sustained multi-regime profitability.',
  },
];

export const INITIAL_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_fill', title: 'First Trade Filled', description: 'Execute your first market or limit order.', unlocked: false },
  { id: 'first_profitable_trade', title: 'First Green Close', description: 'Close a position for a positive realized profit.', unlocked: false },
  { id: 'first_week_profit', title: 'First Profitable Week', description: 'Finish a 5-day trading week with positive net equity gains.', unlocked: false },
  { id: 'margin_cushion_survivor', title: 'Survived a Margin Call', description: 'Recover account equity back above 50% cushion after a margin warning.', unlocked: false },
  { id: 'caught_earnings_gap', title: 'Caught an Earnings Gap', description: 'Realize over $1,500 profit on a stock reporting scheduled quarterly earnings.', unlocked: false },
  { id: 'century_club', title: 'Century Club ($150k)', description: 'Grow total net liquidation value past $150,000.', unlocked: false },
  { id: 'discipline_master', title: 'Risk Disciplined', description: 'Complete 10 consecutive trades using stop losses without exceeding risk limits.', unlocked: false },
  { id: 'short_seller', title: 'Bear Market Operator', description: 'Realize positive gains from an open short position.', unlocked: false },
];

export class CareerEngine {
  private currentRankIndex: number = 0;
  private reputation: number = 0;
  private riskBreaches: number = 0;
  private objectives: WeeklyObjective[];
  private achievements: Achievement[];

  constructor() {
    this.objectives = this.generateObjectivesForWeek(1);
    this.achievements = [...INITIAL_ACHIEVEMENTS];
  }

  getCurrentRank(): CareerRankDefinition {
    return CAREER_RANKS[this.currentRankIndex];
  }

  getNextRank(): CareerRankDefinition | null {
    if (this.currentRankIndex < CAREER_RANKS.length - 1) {
      return CAREER_RANKS[this.currentRankIndex + 1];
    }
    return null;
  }

  getReputation(): number {
    return this.reputation;
  }

  getRiskBreaches(): number {
    return this.riskBreaches;
  }

  getObjectives(): WeeklyObjective[] {
    return this.objectives;
  }

  getAchievements(): Achievement[] {
    return this.achievements;
  }

  checkRankUp(equity: number): { rankedUp: boolean; newRank?: CareerRankDefinition } {
    const next = this.getNextRank();
    if (!next) return { rankedUp: false };

    if (equity >= next.equityTarget && this.reputation >= next.reputationRequired) {
      this.currentRankIndex += 1;
      return { rankedUp: true, newRank: CAREER_RANKS[this.currentRankIndex] };
    }
    return { rankedUp: false };
  }

  addReputation(points: number) {
    this.reputation += points;
  }

  unlockAchievement(id: string): Achievement | null {
    const ach = this.achievements.find(a => a.id === id);
    if (ach && !ach.unlocked) {
      ach.unlocked = true;
      ach.unlockedAt = Date.now();
      return ach;
    }
    return null;
  }

  recordRiskBreach(): { softFail: boolean; message: string; gameOver: boolean } {
    this.riskBreaches += 1;
    if (this.riskBreaches >= 3) {
      return {
        softFail: false,
        gameOver: true,
        message: 'Account terminated after three formal risk limit breaches. Start a fresh career or sandbox.',
      };
    }
    return {
      softFail: true,
      gameOver: false,
      message: `Risk Review Notice: Maximum drawdown exceeded for current rank. Review #${this.riskBreaches} of 3. Positions should be sized conservatively.`,
    };
  }

  generateObjectivesForWeek(simWeek: number): WeeklyObjective[] {
    const pool = [
      {
        id: `obj_${simWeek}_1`,
        title: 'Disciplined Stop Protection',
        description: 'Set a stop loss on at least 3 distinct trades this week.',
        reputationReward: 35,
        completed: false,
        progressText: '0 of 3 stop orders set',
      },
      {
        id: `obj_${simWeek}_2`,
        title: 'Earnings Catalyst Navigation',
        description: 'Hold a position through scheduled quarterly earnings and close for a profit.',
        reputationReward: 50,
        completed: false,
        progressText: '0 of 1 earnings trades completed',
      },
      {
        id: `obj_${simWeek}_3`,
        title: 'Sector Diversification',
        description: 'Maintain open exposure across at least 3 different sectors simultaneously.',
        reputationReward: 40,
        completed: false,
        progressText: 'Sector exposure check pending',
      },
      {
        id: `obj_${simWeek}_4`,
        title: 'Macro Announcement Stability',
        description: 'Finish a day containing a rate or inflation print with positive net equity.',
        reputationReward: 45,
        completed: false,
        progressText: 'Awaiting macro event day',
      },
    ];

    return pool.slice(0, 3);
  }
}
