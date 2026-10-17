import { MarketRegime } from '../engine/correlation';

export interface Scenario {
  id: string;
  title: string;
  briefing: string;
  initialRegime: MarketRegime;
  seed: string;
  targetProfit: number;
  durationDays: number;
  featuredTickers: string[];
  macroCondition: string;
  scoreBenchmark: number; // target score for A-grade
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'rate_shock_autumn',
    title: 'Rate Shock Autumn',
    briefing: 'Stubborn service inflation forces the central bank into unexpected 50 bps rate hikes. Financial net interest margins surge while high-multiple growth technology faces sharp valuation compression. Navigate sector rotation and protect against duration shock.',
    initialRegime: 'bear',
    seed: 'SCENARIO_RATE_SHOCK_2026',
    targetProfit: 15000,
    durationDays: 10,
    featuredTickers: ['BWTR', 'ARDB', 'HLVG', 'NXTL'],
    macroCondition: 'Aggressive Monetary Tightening',
    scoreBenchmark: 8500,
  },
  {
    id: 'sector_bubble_pop',
    title: 'Sector Bubble and Pop',
    briefing: 'Unprecedented institutional demand for battery minerals and clean synthetic fuels drives valuations to historical peaks. Euphoric pre-market gaps give way to sudden distribution cascades. Time short entries and protect gains with trailing stops.',
    initialRegime: 'panic',
    seed: 'SCENARIO_BUBBLE_POP_2026',
    targetProfit: 25000,
    durationDays: 8,
    featuredTickers: ['VRDX', 'ENTX', 'SMRG', 'KRNX'],
    macroCondition: 'Speculative Peak Distribution',
    scoreBenchmark: 9200,
  },
  {
    id: 'squeeze_week',
    title: 'Squeeze Week',
    briefing: 'Heavily shorted small caps encounter coordinated retail accumulation and unexpected positive commercial supply contracts. Hard-to-borrow fees surge past 15%. Capitalize on rapid short-covering volatility without getting trapped at the top.',
    initialRegime: 'chop',
    seed: 'SCENARIO_SQUEEZE_WEEK_2026',
    targetProfit: 20000,
    durationDays: 5,
    featuredTickers: ['KRNX', 'ENTX', 'CRXN', 'ALTA'],
    macroCondition: 'High Short Interest Squeezes',
    scoreBenchmark: 9000,
  },
  {
    id: 'quiet_grind',
    title: 'Quiet Grind',
    briefing: 'Low volatility summer regime with tight spreads and quiet trading ranges. Large market index moves are minimal, requiring disciplined mean reversion trades and patience around quarterly earnings releases.',
    initialRegime: 'chop',
    seed: 'SCENARIO_QUIET_GRIND_2026',
    targetProfit: 10000,
    durationDays: 12,
    featuredTickers: ['GLCN', 'NVPR', 'MRVN', 'AQRX'],
    macroCondition: 'Low Volatility Mean Reversion',
    scoreBenchmark: 8000,
  },
];
