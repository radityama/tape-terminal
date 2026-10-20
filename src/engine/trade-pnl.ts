import { Money } from '../lib/money';
import type { TradeRecord } from './matching';

export type ClosingTrade = Pick<TradeRecord, 'realizedPnl' | 'commission' | 'closingCommission'>;

/**
 * Closing-fill P&L after only the commission allocated to the closed shares.
 * Legacy records without the allocation fall back to their full commission.
 */
export function closingTradeNet(trade: ClosingTrade): number {
  return Money.from(trade.realizedPnl ?? 0).sub(trade.closingCommission ?? trade.commission).toNumber();
}
