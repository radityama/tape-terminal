import { EquityAssetClass } from './assets/equity';
import { OrderBookDepth, OrderBookEngine } from './orderbook';

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type OrderSide = 'buy' | 'sell';
export type TimeInForce = 'DAY' | 'GTC';
export type OrderStatus = 'pending' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQuantity: number;
  limitPrice?: number;
  stopPrice?: number;
  trailingAmount?: number; // dollar distance for trailing stop
  highestPriceObserved?: number; // for sell trailing stop
  lowestPriceObserved?: number; // for buy trailing stop
  timeInForce: TimeInForce;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  averageFillPrice?: number;
  commissionPaid: number;
  // Bracket order attachments
  parentOrderId?: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  isBracketChild?: boolean;
}

export function validOrderValue(shares: number, price: number): boolean {
  return Number.isSafeInteger(shares)
    && shares > 0
    && Number.isFinite(price)
    && price >= 1e-8 // Save decimals have eight places; smaller prices would reload as zero.
    && Number.isSafeInteger(Math.round(shares * price * 100))
    && Math.round(shares * price * 100) > 0;
}

export function validateOrderInput(order: Pick<Order, 'type' | 'quantity'> & Partial<Pick<Order,
  'limitPrice' | 'stopPrice' | 'trailingAmount' | 'takeProfitPrice' | 'stopLossPrice'
>>): string | null {
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) {
    return 'Quantity must be a positive whole number of shares.';
  }

  const required: Record<OrderType, Array<'limitPrice' | 'stopPrice' | 'trailingAmount'>> = {
    market: [], limit: ['limitPrice'], stop: ['stopPrice'],
    stop_limit: ['limitPrice', 'stopPrice'], trailing_stop: ['trailingAmount'],
  };
  if (!Object.hasOwn(required, order.type)) return 'Unknown order type.';
  for (const field of required[order.type]) {
    if (order[field] === undefined) return `${field} is required for ${order.type} orders.`;
  }
  for (const field of ['limitPrice', 'stopPrice', 'trailingAmount', 'takeProfitPrice', 'stopLossPrice'] as const) {
    const price = order[field];
    if (price !== undefined && !validOrderValue(order.quantity, price)) {
      return `${field} must be a positive finite price with a representable trade value.`;
    }
  }
  return null;
}

export function isValidPendingOrder(order: Order): boolean {
  return Number.isSafeInteger(order.filledQuantity)
    && order.filledQuantity >= 0
    && order.filledQuantity < order.quantity
    && !validateOrderInput(order)
    && (order.highestPriceObserved === undefined || validOrderValue(order.quantity - order.filledQuantity, order.highestPriceObserved))
    && (order.lowestPriceObserved === undefined || validOrderValue(order.quantity - order.filledQuantity, order.lowestPriceObserved));
}

export interface TradeRecord {
  id: string;
  orderId: string;
  ticker: string;
  side: OrderSide;
  shares: number;
  price: number;
  totalValue: number;
  commission: number;
  slippageDollars: number;
  timestamp: number;
  isClosingTrade: boolean;
  realizedPnl?: number;
  holdingTimeMinutes?: number;
  rMultiple?: number;
}

export class OrderMatchingEngine {
  private bookEngine: OrderBookEngine;

  constructor(bookEngine: OrderBookEngine) {
    this.bookEngine = bookEngine;
  }

  // Calculate commission transparently based on asset class fee model
  calculateCommission(shares: number, price: number): number {
    const feeModel = EquityAssetClass.feeModel;
    const base = feeModel.basePerTrade;
    const perShare = shares * feeModel.perUnitFee;
    const pct = shares * price * feeModel.percentageFee;
    const total = base + perShare + pct;
    return Math.max(feeModel.minimumFee, Math.round(total * 100) / 100);
  }

  // Check and evaluate active pending orders against current market depth / price
  evaluatePendingOrder(
    order: Order,
    depth: OrderBookDepth,
    currentPrice: number
  ): { shouldFill: boolean; fillPrice: number; slippage: number } | null {
    if (order.status !== 'pending' && order.status !== 'partially_filled') {
      return null;
    }

    if (!isValidPendingOrder(order)) return null;

    const side = order.side;

    switch (order.type) {
      case 'market': {
        const sim = this.bookEngine.simulateFill(side, order.quantity - order.filledQuantity, depth);
        return {
          shouldFill: true,
          fillPrice: sim.averagePrice,
          slippage: sim.slippageDollars,
        };
      }

      case 'limit': {
        if (!order.limitPrice) return null;
        if (side === 'buy' && depth.bestAsk <= order.limitPrice) {
          // Fill at the best available ask, which is favorable or equal to limit
          return {
            shouldFill: true,
            fillPrice: Math.min(order.limitPrice, depth.bestAsk),
            slippage: 0,
          };
        } else if (side === 'sell' && depth.bestBid >= order.limitPrice) {
          return {
            shouldFill: true,
            fillPrice: Math.max(order.limitPrice, depth.bestBid),
            slippage: 0,
          };
        }
        return null;
      }

      case 'stop': {
        if (!order.stopPrice) return null;
        if (side === 'buy' && currentPrice >= order.stopPrice) {
          // Stop triggered: executes as market order
          const sim = this.bookEngine.simulateFill('buy', order.quantity - order.filledQuantity, depth);
          return {
            shouldFill: true,
            fillPrice: sim.averagePrice,
            slippage: sim.slippageDollars,
          };
        } else if (side === 'sell' && currentPrice <= order.stopPrice) {
          const sim = this.bookEngine.simulateFill('sell', order.quantity - order.filledQuantity, depth);
          return {
            shouldFill: true,
            fillPrice: sim.averagePrice,
            slippage: sim.slippageDollars,
          };
        }
        return null;
      }

      case 'stop_limit': {
        if (!order.stopPrice || !order.limitPrice) return null;
        // Triggers once price crosses stop threshold, fills only if limit condition satisfied
        const triggered = side === 'buy' ? currentPrice >= order.stopPrice : currentPrice <= order.stopPrice;
        if (triggered) {
          if (side === 'buy' && depth.bestAsk <= order.limitPrice) {
            return {
              shouldFill: true,
              fillPrice: depth.bestAsk,
              slippage: 0,
            };
          } else if (side === 'sell' && depth.bestBid >= order.limitPrice) {
            return {
              shouldFill: true,
              fillPrice: depth.bestBid,
              slippage: 0,
            };
          }
        }
        return null;
      }

      case 'trailing_stop': {
        if (!order.trailingAmount) return null;
        if (side === 'sell') {
          // Track peak price
          const peak = Math.max(order.highestPriceObserved || currentPrice, currentPrice);
          order.highestPriceObserved = peak;
          const stopLevel = peak - order.trailingAmount;
          if (currentPrice <= stopLevel) {
            const sim = this.bookEngine.simulateFill('sell', order.quantity - order.filledQuantity, depth);
            return {
              shouldFill: true,
              fillPrice: sim.averagePrice,
              slippage: sim.slippageDollars,
            };
          }
        } else if (side === 'buy') {
          const trough = Math.min(order.lowestPriceObserved || currentPrice, currentPrice);
          order.lowestPriceObserved = trough;
          const stopLevel = trough + order.trailingAmount;
          if (currentPrice >= stopLevel) {
            const sim = this.bookEngine.simulateFill('buy', order.quantity - order.filledQuantity, depth);
            return {
              shouldFill: true,
              fillPrice: sim.averagePrice,
              slippage: sim.slippageDollars,
            };
          }
        }
        return null;
      }

      default:
        return null;
    }
  }
}
