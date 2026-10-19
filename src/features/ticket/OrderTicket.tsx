'use client';

import React, { useState, useMemo } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANY_MAP } from '../../data/companies';
import { OrderSide, OrderType, TimeInForce } from '../../engine/matching';
import { EquityAssetClass } from '../../engine/assets/equity';

export function OrderTicket() {
  const selectedTicker = useTerminalStore((s) => s.selectedTicker);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const engine = useTerminalStore((s) => s.engine);
  const placeOrder = useTerminalStore((s) => s.placeOrder);
  const career = snapshot?.career;

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState<number>(100);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [trailingAmount, setTrailingAmount] = useState<string>('2.50');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('DAY');

  // Bracket orders toggle
  const [hasBracket, setHasBracket] = useState<boolean>(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState<string>('');
  const [stopLossPrice, setStopLossPrice] = useState<string>('');

  // Confirmation modal state for orders > 25% of equity
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const company = COMPANY_MAP.get(selectedTicker);
  const currentPriceObj = snapshot?.prices.find((p) => p.ticker === selectedTicker);
  const currentPrice = currentPriceObj?.price ?? company?.initialPrice ?? 100;
  const depth = engine?.getDepth(selectedTicker);
  const risk = snapshot?.riskMetrics;

  // Short selling unlock check (rank order >= 2)
  const isShortUnlocked = (career?.rank?.order ?? 1) >= 2;
  // Margin unlock check (rank order >= 3)
  const isMarginUnlocked = (career?.rank?.order ?? 1) >= 3;
  // Rank 1 accounts can still close a long position even while shorts stay locked.
  const heldShares = snapshot?.positions.find((p) => p.ticker === selectedTicker)?.shares ?? 0;
  const canSell = isShortUnlocked || heldShares > 0;
  const activeSide: OrderSide = canSell ? side : 'buy';

  // Pre-trade calculation
  const preTrade = useMemo(() => {
    const qty = Math.max(1, quantity || 1);
    let basePrice = currentPrice;

    if (depth) {
      basePrice = activeSide === 'buy' ? depth.bestAsk : depth.bestBid;
    }

    // Estimate fill price with book walk
    let estFillPrice = basePrice;
    let estSlippageDollars = 0;
    let estSlippageBps = 0;

    if (orderType === 'limit' && limitPrice && parseFloat(limitPrice) > 0) {
      estFillPrice = parseFloat(limitPrice);
    } else if (depth) {
      // Simulate fill with depth ladder
      const levels = activeSide === 'buy' ? depth.asks : depth.bids;
      let rem = qty;
      let accum = 0;
      for (const lvl of levels) {
        if (rem <= 0) break;
        const take = Math.min(rem, lvl.size);
        accum += take * lvl.price;
        rem -= take;
      }
      if (rem > 0) {
        const last = levels[levels.length - 1];
        accum += rem * (activeSide === 'buy' ? last.price + depth.spread : Math.max(0.01, last.price - depth.spread));
      }
      estFillPrice = Math.round((accum / qty) * 100) / 100;
      estSlippageDollars = Math.abs(estFillPrice - basePrice);
      estSlippageBps = basePrice > 0 ? Math.round((estSlippageDollars / basePrice) * 10000 * 10) / 10 : 0;
    }

    // Commission
    const feeModel = EquityAssetClass.feeModel;
    const rawComm = feeModel.basePerTrade + qty * feeModel.perUnitFee + qty * estFillPrice * feeModel.percentageFee;
    const estCommission = Math.max(feeModel.minimumFee, Math.round(rawComm * 100) / 100);

    const totalTradeCost = Math.round((qty * estFillPrice + estCommission) * 100) / 100;
    const currentEquity = risk?.netLiquidationValue || 100000;
    const currentCash = risk?.cashBalance || 100000;
    const currentBuyingPower = risk?.buyingPower || 100000;

    const resultingCash = activeSide === 'buy' ? currentCash - totalTradeCost : currentCash + (qty * estFillPrice) - estCommission;
    const resultingBuyingPower = Math.max(0, currentBuyingPower - totalTradeCost);
    const positionFraction = currentEquity > 0 ? (totalTradeCost / currentEquity) * 100 : 0;
    const isLargeOrder = positionFraction >= 25;

    return {
      estFillPrice,
      estSlippageDollars,
      estSlippageBps,
      estCommission,
      totalTradeCost,
      resultingCash,
      resultingBuyingPower,
      positionFraction,
      isLargeOrder,
      hasSufficientBuyingPower: activeSide === 'sell' || totalTradeCost <= currentBuyingPower,
    };
  }, [quantity, activeSide, orderType, limitPrice, currentPrice, depth, risk]);

  const handleQuickQty = (percent: number) => {
    const bp = risk?.buyingPower || 10000;
    const maxAffordable = Math.floor(bp / (currentPrice * 1.01));
    const target = Math.max(1, Math.floor(maxAffordable * (percent / 100)));
    setQuantity(target);
  };

  const handleOrderSubmit = () => {
    if (preTrade.isLargeOrder && !showConfirmModal) {
      setShowConfirmModal(true);
      return;
    }
    executeOrderPlacement();
  };

  const executeOrderPlacement = () => {
    setShowConfirmModal(false);

    const lPrice = limitPrice ? parseFloat(limitPrice) : undefined;
    const sPrice = stopPrice ? parseFloat(stopPrice) : undefined;
    const tAmount = trailingAmount ? parseFloat(trailingAmount) : undefined;
    const tp = hasBracket && takeProfitPrice ? parseFloat(takeProfitPrice) : undefined;
    const sl = hasBracket && stopLossPrice ? parseFloat(stopLossPrice) : undefined;

    placeOrder({
      ticker: selectedTicker,
      side: activeSide,
      type: orderType,
      quantity,
      limitPrice: lPrice,
      stopPrice: sPrice,
      trailingAmount: tAmount,
      timeInForce,
      takeProfitPrice: tp,
      stopLossPrice: sl,
    });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-1)] select-none text-[12px]" id="tutorial-ticket">
      {/* Header */}
      <div className="h-[28px] border-b border-[var(--line)] px-2.5 flex items-center justify-between shrink-0 bg-[var(--bg-1)]">
        <span className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wider">
          Order Ticket: {selectedTicker}
        </span>
        <span className="font-mono text-[10px] text-[var(--text-3)]">
          {company?.sector}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {/* Buy / Sell Selector */}
        <div className="grid grid-cols-2 gap-1 bg-[var(--bg-0)] p-0.5 rounded-[2px] border border-[var(--line)]">
          <button
            onClick={() => setSide('buy')}
            className={`py-1 text-center font-bold font-mono text-[11px] rounded-[2px] transition-colors cursor-pointer ${
              activeSide === 'buy'
                ? 'bg-[var(--up)] text-black'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            BUY / LONG
          </button>
          <button
            onClick={() => {
              if (!canSell) return;
              setSide('sell');
            }}
            disabled={!canSell}
            className={`py-1 text-center font-bold font-mono text-[11px] rounded-[2px] transition-colors cursor-pointer ${
              activeSide === 'sell'
                ? 'bg-[var(--down)] text-white'
                : !canSell
                ? 'text-[var(--text-3)] opacity-40 cursor-not-allowed'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
            title={!canSell ? 'Short selling unlocks at Rank 2 (Junior Trader); you have no long position to close' : undefined}
          >
            SELL {!canSell ? '(LOCKED)' : isShortUnlocked ? '/ SHORT' : '/ CLOSE'}
          </button>
        </div>

        {/* Order Type & TIF */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block mb-1">
              Order Type
            </label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              className="w-full h-[26px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] font-mono cursor-pointer"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
              <option value="stop">Stop</option>
              <option value="stop_limit">Stop-Limit</option>
              <option value="trailing_stop">Trailing Stop</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block mb-1">
              Time In Force
            </label>
            <select
              value={timeInForce}
              onChange={(e) => setTimeInForce(e.target.value as TimeInForce)}
              className="w-full h-[26px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] font-mono cursor-pointer"
            >
              <option value="DAY">DAY (Session)</option>
              <option value="GTC">GTC (Good Till Cancel)</option>
            </select>
          </div>
        </div>

        {/* Quantity Input + Quick Percentage Buttons */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)]">
              Quantity (Shares)
            </label>
            <span className="text-[10px] font-mono text-[var(--text-3)]">
              Max: {Math.floor((risk?.buyingPower || 10000) / currentPrice)} shs
            </span>
          </div>

          <input
            type="number"
            min={1}
            max={100000}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full h-[28px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 font-mono text-[13px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] text-right"
          />

          <div className="grid grid-cols-4 gap-1 mt-1">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handleQuickQty(pct)}
                className="py-0.5 text-[10px] font-mono bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Limit Price Input */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <div>
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block mb-1">
              Limit Price ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={limitPrice}
              placeholder={currentPrice.toFixed(2)}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full h-[28px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 font-mono text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] text-right"
            />
          </div>
        )}

        {/* Stop Price Input */}
        {(orderType === 'stop' || orderType === 'stop_limit') && (
          <div>
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block mb-1">
              Stop Trigger Price ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={stopPrice}
              placeholder={(currentPrice * 0.95).toFixed(2)}
              onChange={(e) => setStopPrice(e.target.value)}
              className="w-full h-[28px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 font-mono text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] text-right"
            />
          </div>
        )}

        {/* Trailing Stop Delta Input */}
        {orderType === 'trailing_stop' && (
          <div>
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block mb-1">
              Trailing Distance ($)
            </label>
            <input
              type="number"
              step="0.05"
              value={trailingAmount}
              onChange={(e) => setTrailingAmount(e.target.value)}
              className="w-full h-[28px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 font-mono text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] text-right"
            />
          </div>
        )}

        {/* Bracket Order Option */}
        <div className="pt-1 border-t border-[var(--line)]">
          <label className="flex items-center space-x-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={hasBracket}
              onChange={(e) => setHasBracket(e.target.checked)}
              className="accent-[var(--accent)] cursor-pointer"
            />
            <span className="text-[11px] font-mono text-[var(--text-2)]">
              Attach Bracket Order (Take Profit + Stop Loss)
            </span>
          </label>

          {hasBracket && (
            <div className="grid grid-cols-2 gap-2 bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
              <div>
                <label className="text-[9px] uppercase font-mono text-[var(--up)] block mb-0.5">
                  Take Profit ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder={(currentPrice * 1.08).toFixed(2)}
                  value={takeProfitPrice}
                  onChange={(e) => setTakeProfitPrice(e.target.value)}
                  className="w-full h-[24px] bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px] px-1.5 font-mono text-[11px] text-[var(--text-1)] text-right outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono text-[var(--down)] block mb-0.5">
                  Stop Loss ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder={(currentPrice * 0.94).toFixed(2)}
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  className="w-full h-[24px] bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px] px-1.5 font-mono text-[11px] text-[var(--text-1)] text-right outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Pre-Trade Execution Transparency Breakdown */}
        <div className="bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] p-2 space-y-1.5 font-mono text-[11px]">
          <div className="flex justify-between text-[var(--text-3)] text-[10px] uppercase border-b border-[var(--line)] pb-1">
            <span>Pre-Trade Estimate</span>
            <span>Values</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">Est. Fill Price:</span>
            <span className="text-[var(--text-1)] font-medium">${preTrade.estFillPrice.toFixed(2)}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">Est. Slippage:</span>
            <span className="text-[var(--text-2)]">${preTrade.estSlippageDollars.toFixed(2)} ({preTrade.estSlippageBps} bps)</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">Commission & Fees:</span>
            <span className="text-[var(--text-2)]">${preTrade.estCommission.toFixed(2)}</span>
          </div>

          <div className="flex justify-between border-t border-[var(--line)] pt-1">
            <span className="text-[var(--text-3)]">Total Trade Value:</span>
            <span className="text-[var(--text-1)] font-semibold">${preTrade.totalTradeCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">Resulting Buying Power:</span>
            <span className={`${preTrade.hasSufficientBuyingPower ? 'text-[var(--text-1)]' : 'text-[var(--down)] font-semibold'}`}>
              ${preTrade.resultingBuyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">Resulting Position %:</span>
            <span className={`${preTrade.positionFraction > 25 ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'}`}>
              {preTrade.positionFraction.toFixed(1)}% of equity
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div>
          <button
            onClick={handleOrderSubmit}
            disabled={!preTrade.hasSufficientBuyingPower}
            className={`w-full py-2 rounded-[2px] font-mono font-bold text-[12px] uppercase tracking-wide transition-all cursor-pointer ${
              !preTrade.hasSufficientBuyingPower
                ? 'bg-[var(--line)] text-[var(--text-3)] cursor-not-allowed'
                : activeSide === 'buy'
                ? 'bg-[var(--up)] text-black hover:brightness-105 active:translate-y-[1px]'
                : 'bg-[var(--down)] text-white hover:brightness-105 active:translate-y-[1px]'
            }`}
          >
            {preTrade.hasSufficientBuyingPower ? `Place ${activeSide.toUpperCase()} Order` : 'Insufficient Buying Power'}
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Large Orders (> 25% Equity) */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-1)] border border-[var(--accent)] rounded-[2px] max-w-sm w-full p-4 space-y-3 font-sans">
            <div className="text-[14px] font-bold text-[var(--accent)] font-mono">
              Large Position Warning
            </div>
            <p className="text-[12px] text-[var(--text-2)] leading-relaxed">
              This order allocates <span className="font-mono font-bold text-[var(--text-1)]">{preTrade.positionFraction.toFixed(1)}%</span> of your total net account equity into <span className="font-mono font-bold text-[var(--text-1)]">{selectedTicker}</span>.
            </p>
            <div className="bg-[var(--bg-0)] p-2 rounded-[2px] font-mono text-[11px] space-y-1">
              <div>Shares: {quantity} shs</div>
              <div>Estimated Total: ${preTrade.totalTradeCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div>Estimated Fill: ${preTrade.estFillPrice.toFixed(2)}</div>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1 bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-[2px] text-[11px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={executeOrderPlacement}
                className="px-3 py-1 bg-[var(--accent)] hover:brightness-105 text-[var(--bg-0)] font-semibold rounded-[2px] text-[11px] cursor-pointer"
              >
                Confirm Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
