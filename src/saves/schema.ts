import { z } from 'zod';

// Version of the on-disk / on-wire save format. Bump when the shape changes and add a migration.
export const SCHEMA_VERSION = 1;

// Anything that is money or a decimal ratio is stored as a string and never as a float.
// The codec accepts a legacy number or a decimal string on the way in, and always writes a string.
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

const moneyAsString = z.codec(z.union([z.number(), decimalString]), z.string(), {
  decode: (v) => String(v),
  encode: (v) => v,
});

const moneyAsNumber = z.codec(z.union([z.number(), decimalString]), z.number(), {
  decode: (v) => Number(v),
  encode: (v) => String(v),
});

const optMoney = moneyAsNumber.optional();

const candleSchema = z.object({
  time: z.number().int(),
  open: moneyAsNumber,
  high: moneyAsNumber,
  low: moneyAsNumber,
  close: moneyAsNumber,
  volume: z.number(),
});

const assetPriceStateSchema = z.object({
  ticker: z.string(),
  price: moneyAsNumber,
  openPrice: moneyAsNumber,
  highPrice: moneyAsNumber,
  lowPrice: moneyAsNumber,
  previousClose: moneyAsNumber,
  change: moneyAsNumber,
  changePercent: moneyAsNumber,
  volume: z.number(),
  currentVol: z.number(),
  vwap: moneyAsNumber,
  cumulativeValue: moneyAsNumber,
  cumulativeVolume: z.number(),
  candles1m: z.array(candleSchema),
  candles5m: z.array(candleSchema),
  candles15m: z.array(candleSchema),
  candles1h: z.array(candleSchema),
  candles1D: z.array(candleSchema),
  lastTickDirection: z.enum(['up', 'down', 'flat']),
  lastMoveDirection: z.enum(['up', 'down']),
  baseLambda: z.number(),
  timeUntilNextUpdate: z.number(),
  accumulatedSimSeconds: z.number(),
});

const pricingEngineStateSchema = z.object({
  regime: z.enum(['bull', 'bear', 'chop', 'panic']),
  regimeDurationDays: z.number(),
  states: z.array(assetPriceStateSchema),
});

const positionSchema = z.object({
  ticker: z.string(),
  shares: z.number(),
  averageEntryPrice: moneyAsNumber,
  currentPrice: moneyAsNumber,
  marketValue: moneyAsNumber,
  costBasis: moneyAsNumber,
  unrealizedPnl: moneyAsNumber,
  unrealizedPnlPercent: z.number(),
  entryTimestamp: z.number(),
  borrowFeeAccumulated: moneyAsNumber,
  initialStopPrice: optMoney,
});

const tradeRecordSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  ticker: z.string(),
  side: z.enum(['buy', 'sell']),
  shares: z.number(),
  price: moneyAsNumber,
  totalValue: moneyAsNumber,
  commission: moneyAsNumber,
  slippageDollars: moneyAsNumber,
  timestamp: z.number(),
  isClosingTrade: z.boolean(),
  realizedPnl: optMoney,
  holdingTimeMinutes: z.number().optional(),
  rMultiple: z.number().optional(),
});

const portfolioEngineStateSchema = z.object({
  cash: moneyAsString,
  startingCapital: moneyAsString,
  positions: z.array(positionSchema),
  tradeHistory: z.array(tradeRecordSchema),
  marginUnlocked: z.boolean(),
  shortingUnlocked: z.boolean(),
  dayStartEquity: moneyAsString,
  peakEquity: moneyAsString,
  maxDrawdownPercent: z.number(),
});

const weeklyObjectiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  reputationReward: z.number(),
  completed: z.boolean(),
  progressText: z.string(),
});

const achievementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  unlocked: z.boolean(),
  unlockedAt: z.number().optional(),
});

const careerEngineStateSchema = z.object({
  currentRankIndex: z.number().int(),
  reputation: z.number(),
  riskBreaches: z.number(),
  objectives: z.array(weeklyObjectiveSchema),
  achievements: z.array(achievementSchema),
});

const rivalTraderSchema = z.object({
  id: z.string(),
  name: z.string(),
  firm: z.string(),
  style: z.enum([
    'Momentum Breakout',
    'Deep Value',
    'Contrarian Reversal',
    'News Scalper',
    'Overleveraged Degenerate',
    'Index Hugger',
    'Mean Reversion',
    'Quantitative Volatility',
  ]),
  bio: z.string(),
  initialCapital: moneyAsNumber,
  currentEquity: moneyAsNumber,
  totalPnl: moneyAsNumber,
  totalReturnPct: z.number(),
  sharpeRatio: z.number(),
  winRate: z.number(),
  currentHoldings: z.array(
    z.object({ ticker: z.string(), shares: z.number(), weightPct: z.number() })
  ),
});

const rivalEngineStateSchema = z.object({ rivals: z.array(rivalTraderSchema) });

const orderSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']),
  quantity: z.number(),
  filledQuantity: z.number(),
  limitPrice: optMoney,
  stopPrice: optMoney,
  trailingAmount: optMoney,
  highestPriceObserved: optMoney,
  lowestPriceObserved: optMoney,
  timeInForce: z.enum(['DAY', 'GTC']),
  status: z.enum(['pending', 'partially_filled', 'filled', 'cancelled', 'rejected']),
  createdAt: z.number(),
  filledAt: z.number().optional(),
  averageFillPrice: optMoney,
  commissionPaid: moneyAsNumber,
  parentOrderId: z.string().optional(),
  takeProfitPrice: optMoney,
  stopLossPrice: optMoney,
  isBracketChild: z.boolean().optional(),
});

const marketEventSchema = z.object({
  id: z.string(),
  category: z.enum(['earnings', 'company_news', 'macro', 'black_swan']),
  timestamp: z.number(),
  simDay: z.number(),
  ticker: z.string().optional(),
  sector: z
    .enum(['Technology', 'Financials', 'Energy', 'Healthcare', 'Consumer', 'Industrials', 'Materials', 'Utilities'])
    .optional(),
  headline: z.string(),
  body: z.string(),
  trueImpact: moneyAsNumber,
  volatilitySurge: moneyAsNumber,
  isRumor: z.boolean().optional(),
  isAmbiguous: z.boolean().optional(),
  scheduledTime: z.number().optional(),
  earningsDetails: z
    .object({
      quarter: z.string(),
      consensusEps: moneyAsNumber,
      actualEps: moneyAsNumber,
      surprisePct: moneyAsNumber,
      consensusRevenue: moneyAsNumber,
      actualRevenue: moneyAsNumber,
    })
    .optional(),
});

const marketEngineStateSchema = z.object({
  seed: z.string(),
  // Output stays a plain number so the decoded save is directly assignable to the engine state.
  speed: z.number().int(),
  simDay: z.number().int(),
  simSecondsOfDay: z.number(),
  session: z.enum(['pre_market', 'regular', 'after_hours', 'closed']),
  rngState: z.number(),
  pricing: pricingEngineStateSchema,
  portfolio: portfolioEngineStateSchema,
  career: careerEngineStateSchema,
  rivals: rivalEngineStateSchema,
  openOrders: z.array(orderSchema),
  activeNews: z.array(marketEventSchema),
  upcomingEarnings: z.array(marketEventSchema),
});

export const SaveGameSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  slot: z.number().int().min(1).max(3),
  name: z.string().min(1).max(40),
  seed: z.string(),
  mode: z.enum(['career', 'sandbox']),
  scenarioId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  revision: z.number().int().min(1),
  deviceId: z.string(),
  summary: z.object({
    rank: z.string().nullable(),
    equity: moneyAsNumber,
    simDay: z.number().int(),
  }),
  game: marketEngineStateSchema,
});

export type SaveGame = z.infer<typeof SaveGameSchema>;

export const SaveMetaSchema = z.object({
  slot: z.number().int().min(1).max(3),
  name: z.string(),
  seed: z.string(),
  mode: z.enum(['career', 'sandbox']),
  rank: z.string().nullable(),
  equity: z.number(),
  simDay: z.number().int(),
  updatedAt: z.number(),
  revision: z.number().int(),
  deviceId: z.string(),
});

export type SaveMeta = z.infer<typeof SaveMetaSchema>;

export function saveToMeta(save: SaveGame): SaveMeta {
  return {
    slot: save.slot,
    name: save.name,
    seed: save.seed,
    mode: save.mode,
    rank: save.summary.rank,
    equity: save.summary.equity,
    simDay: save.summary.simDay,
    updatedAt: save.updatedAt,
    revision: save.revision,
    deviceId: save.deviceId,
  };
}

// UI settings and tutorial progress live in their own small blob, never in a game save.
export const ProfileSchema = z.object({
  schemaVersion: z.number().int(),
  settings: z.looseObject({
    difficulty: z.enum(['learner', 'standard', 'hardcore']),
    soundEnabled: z.boolean(),
    tapeStripEnabled: z.boolean(),
    priceFlashSetting: z.string(),
    selectedTimeframe: z.enum(['1m', '5m', '15m', '1h', '1D']),
    activeWorkspaceLayout: z.enum(['trade', 'research', 'risk']),
    chartIndicators: z.looseObject({
      volume: z.boolean(),
      sma20: z.boolean(),
      ema50: z.boolean(),
      vwap: z.boolean(),
      bollinger: z.boolean(),
      rsi: z.boolean(),
      macd: z.boolean(),
    }),
  }),
  tutorial: z.object({ completed: z.boolean(), step: z.number().int() }),
  layouts: z.looseObject({}),
  updatedAt: z.number(),
});

export type Profile = z.infer<typeof ProfileSchema>;

// Caps for the stored candle history. Recent bars stay fine-grained, older ones compact to coarser bars.
export const CANDLE_CAPS = { fine: 180, medium: 120, coarse: 250 } as const;
export const SAVE_SIZE_SOFT_LIMIT = 1024 * 1024;
export const SAVE_SIZE_HARD_LIMIT = 2 * 1024 * 1024;
