import { Company, Sector, SECTORS } from '../data/companies';
import { SeededRNG } from './rng';

export type EventCategory = 'earnings' | 'company_news' | 'macro' | 'black_swan';

export interface MarketEvent {
  id: string;
  category: EventCategory;
  timestamp: number; // sim timestamp
  simDay: number;
  ticker?: string;
  sector?: Sector;
  headline: string;
  body: string;
  trueImpact: number; // decimal price jump or sector drift shock (e.g. +0.08 for +8%)
  volatilitySurge: number; // multiplier on spread and vol
  isRumor?: boolean;
  isAmbiguous?: boolean;
  scheduledTime?: number; // for calendar events
  // For earnings
  earningsDetails?: {
    quarter: string;
    consensusEps: number;
    actualEps: number;
    surprisePct: number;
    consensusRevenue: number;
    actualRevenue: number;
  };
}

export class EventGenerator {
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  // Generate quarterly scheduled earnings calendar for the next N days
  generateEarningsCalendar(
    companies: Company[],
    currentSimDay: number,
    horizonDays: number = 30
  ): MarketEvent[] {
    const calendar: MarketEvent[] = [];

    // Distribute companies across quarterly earnings dates
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      // Deterministic day based on index
      const dayOffset = (i % horizonDays) + 1;
      const earningsDay = currentSimDay + dayOffset;

      const baseEps = company.fundamentals.eps / 4;
      const consensusEps = Math.round(baseEps * 100) / 100;
      
      // Surprise factor (-25% to +25%)
      const surprise = this.rng.nextGaussian(0.02, 0.12);
      const actualEps = Math.round((consensusEps * (1 + surprise)) * 100) / 100;
      const surprisePct = Math.round(surprise * 1000) / 10;

      const baseRev = company.fundamentals.revenue / 4;
      const consensusRev = Math.round(baseRev * 100) / 100;
      const actualRev = Math.round((consensusRev * (1 + surprise * 0.6)) * 100) / 100;

      // Jump impact is proportional to surprise
      const trueImpact = surprise * 0.75;

      const beatOrMiss = surprisePct >= 0 ? 'Beats' : 'Misses';
      const headline = `${company.ticker} Q${((earningsDay % 4) + 1)} Earnings: ${beatOrMiss} Consensus by ${Math.abs(surprisePct)}%`;
      const body = `${company.name} reports quarterly EPS of $${actualEps.toFixed(2)} versus $${consensusEps.toFixed(2)} expected on revenue of $${actualRev.toFixed(2)}B.`;

      calendar.push({
        id: `earn_${company.ticker}_day${earningsDay}`,
        category: 'earnings',
        timestamp: 0,
        simDay: earningsDay,
        ticker: company.ticker,
        sector: company.sector,
        headline,
        body,
        trueImpact,
        volatilitySurge: 1.8,
        earningsDetails: {
          quarter: `Q${((earningsDay % 4) + 1)}`,
          consensusEps,
          actualEps,
          surprisePct,
          consensusRevenue: consensusRev,
          actualRevenue: actualRev,
        },
      });
    }

    return calendar;
  }

  // Generate spontaneous news event during active simulation
  generateRandomNews(
    companies: Company[],
    simDay: number,
    timestamp: number
  ): MarketEvent | null {
    const roll = this.rng.next();

    // 1. Rare Black Swan event (0.5% chance per call)
    if (roll < 0.005) {
      return this.generateBlackSwan(companies, simDay, timestamp);
    }

    // 2. Macro event (15% chance per call)
    if (roll < 0.155) {
      return this.generateMacroEvent(simDay, timestamp);
    }

    // 3. Company-specific news (84% chance)
    return this.generateCompanyNews(companies, simDay, timestamp);
  }

  private generateCompanyNews(
    companies: Company[],
    simDay: number,
    timestamp: number
  ): MarketEvent {
    const company = this.rng.pick(companies);
    const flavorRoll = this.rng.next();

    if (flavorRoll < 0.25) {
      // Contract award / commercial expansion (+)
      const impact = 0.03 + this.rng.next() * 0.06;
      return {
        id: `news_${timestamp}_${company.ticker}`,
        category: 'company_news',
        timestamp,
        simDay,
        ticker: company.ticker,
        sector: company.sector,
        headline: `${company.ticker} Awarded Multi-Year Commercial Supply Contract`,
        body: `${company.name} finalized an agreement providing equipment and ongoing services starting next fiscal quarter.`,
        trueImpact: impact,
        volatilitySurge: 1.4,
      };
    } else if (flavorRoll < 0.50) {
      // Guidance revision (-)
      const impact = -(0.04 + this.rng.next() * 0.08);
      return {
        id: `news_${timestamp}_${company.ticker}`,
        category: 'company_news',
        timestamp,
        simDay,
        ticker: company.ticker,
        sector: company.sector,
        headline: `${company.ticker} Lowers Full-Year Operating Margin Guidance`,
        body: `Management cited elevated supply chain inputs and extended customer procurement cycles for the downward adjustment.`,
        trueImpact: impact,
        volatilitySurge: 1.9,
      };
    } else if (flavorRoll < 0.75) {
      // Ambiguous corporate update (?)
      const impact = (this.rng.next() - 0.48) * 0.05;
      return {
        id: `news_${timestamp}_${company.ticker}`,
        category: 'company_news',
        timestamp,
        simDay,
        ticker: company.ticker,
        sector: company.sector,
        headline: `${company.ticker} Board Evaluates Strategic Portfolio Alternatives`,
        body: `The board of directors retained financial advisors to review capital allocation and standalone operations.`,
        trueImpact: impact,
        volatilitySurge: 1.6,
        isAmbiguous: true,
      };
    } else {
      // Rumor that could be true or false
      const isTrue = this.rng.next() > 0.5;
      const impact = isTrue ? 0.05 : -0.02;
      return {
        id: `news_${timestamp}_${company.ticker}`,
        category: 'company_news',
        timestamp,
        simDay,
        ticker: company.ticker,
        sector: company.sector,
        headline: `Market Rumor: Potential Private Equity Interest in ${company.ticker}`,
        body: `Unverified desk chatter points to informal discussions regarding a leveraged acquisition premium.`,
        trueImpact: impact,
        volatilitySurge: 2.2,
        isRumor: true,
      };
    }
  }

  private generateMacroEvent(simDay: number, timestamp: number): MarketEvent {
    const macroTypes = [
      {
        headline: 'Federal Central Bank Hikes Benchmark Rate 25 Basis Points',
        body: 'Policy committee notes persistent services inflation. Financial sector margins benefit while high-multiple technology encounters valuation compression.',
        sector: 'Financials' as Sector,
        trueImpact: 0.025, // Banks up
        volatilitySurge: 1.6,
      },
      {
        headline: 'Core CPI Prints Cooler Than Forecast at 2.4% Annualized',
        body: 'Consumer prices decelerate across freight and durable goods. Market broadens rally across cyclical and growth equities.',
        sector: 'Technology' as Sector,
        trueImpact: 0.035,
        volatilitySurge: 1.4,
      },
      {
        headline: 'Labor Department Reports 260,000 Nonfarm Payrolls Added',
        body: 'Headline employment print exceeds consensus estimates. Treasury yields rise as rate cuts are pushed back.',
        sector: 'Industrials' as Sector,
        trueImpact: 0.015,
        volatilitySurge: 1.3,
      },
      {
        headline: 'Geopolitical Shipping Disruptions Send Crude Oil Up 4%',
        body: 'Tanker rerouting through southern capes increases transit days. Upstream energy producers rally while airline and consumer logistics costs mount.',
        sector: 'Energy' as Sector,
        trueImpact: 0.045,
        volatilitySurge: 1.8,
      },
    ];

    const pick = this.rng.pick(macroTypes);
    return {
      id: `macro_${timestamp}`,
      category: 'macro',
      timestamp,
      simDay,
      sector: pick.sector,
      headline: pick.headline,
      body: pick.body,
      trueImpact: pick.trueImpact,
      volatilitySurge: pick.volatilitySurge,
    };
  }

  private generateBlackSwan(
    companies: Company[],
    simDay: number,
    timestamp: number
  ): MarketEvent {
    const targetComp = this.rng.pick(companies);
    const types = [
      {
        headline: `Regulatory Audit Halts Trading in ${targetComp.ticker}`,
        body: `Accounting irregularities uncovered in secondary overseas subsidiaries prompt temporary inquiry and emergency trading halt.`,
        trueImpact: -0.22,
        ticker: targetComp.ticker,
        sector: targetComp.sector,
      },
      {
        headline: `Algorithmic Liquidity Cascade Triggers Market-Wide Flash Dip`,
        body: `Coordinated stop-loss triggers across automated institutional desks momentarily sweep aggregate market depth.`,
        trueImpact: -0.065,
        sector: 'Financials' as Sector,
      },
      {
        headline: `Major Critical Infrastructure Cyber Incident Disables Regional Pipeline`,
        body: `Emergency failover protocols engaged across petrochemical terminals, causing immediate supply dislocations.`,
        trueImpact: -0.08,
        sector: 'Utilities' as Sector,
      },
    ];

    const pick = this.rng.pick(types);
    return {
      id: `blackswan_${timestamp}`,
      category: 'black_swan',
      timestamp,
      simDay,
      ticker: pick.ticker,
      sector: pick.sector,
      headline: pick.headline,
      body: pick.body,
      trueImpact: pick.trueImpact,
      volatilitySurge: 3.5,
    };
  }
}
