'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANY_MAP } from '../../data/companies';

export function Level2Depth() {
  const selectedTicker = useTerminalStore((s) => s.selectedTicker);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const engine = useTerminalStore((s) => s.engine);

  const career = snapshot?.career;
  const isLevel2Unlocked = (career?.rank?.order ?? 1) >= 4;

  const depth = engine?.getDepth(selectedTicker);
  const company = COMPANY_MAP.get(selectedTicker);

  if (!depth) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-[11px] text-[var(--text-3)] font-mono">
        Loading depth liquidity...
      </div>
    );
  }

  // Max cumulative size for bar percentage width calculation
  const maxBidSize = depth.bids[depth.bids.length - 1]?.total || 1000;
  const maxAskSize = depth.asks[depth.asks.length - 1]?.total || 1000;
  const maxTotal = Math.max(maxBidSize, maxAskSize, 1);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-1)] select-none text-[11px] font-mono border-t border-[var(--line)]">
      {/* Level 1 Summary Bar */}
      <div className="h-[28px] px-2.5 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-0)]">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] uppercase text-[var(--text-3)]">Level 1</span>
          <span className="text-[var(--up)] font-semibold">${depth.bestBid.toFixed(2)}</span>
          <span className="text-[var(--text-3)]">x</span>
          <span className="text-[var(--down)] font-semibold">${depth.bestAsk.toFixed(2)}</span>
        </div>

        <div className="text-[10px] text-[var(--text-2)]">
          Spread: <span className="text-[var(--text-1)]">${depth.spread.toFixed(2)}</span> ({depth.spreadBps} bps)
        </div>
      </div>

      {/* Level 2 Depth Ladder (5 levels) */}
      {isLevel2Unlocked ? (
        <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {/* Bids side (High to Low) */}
            <div>
              <div className="grid grid-cols-3 text-[9px] uppercase text-[var(--text-3)] border-b border-[var(--line)] pb-0.5 mb-1 px-1">
                <span>Size</span>
                <span className="text-right">Total</span>
                <span className="text-right text-[var(--up)]">Bid</span>
              </div>
              <div className="space-y-0.5">
                {depth.bids.map((b, i) => {
                  const widthPct = Math.min(100, Math.round((b.total / maxTotal) * 100));
                  return (
                    <div key={i} className="relative grid grid-cols-3 px-1 py-0.5 text-[10px] items-center">
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-[var(--up)]/15 pointer-events-none rounded-[1px]"
                        style={{ width: `${widthPct}%` }}
                      />
                      <span className="relative z-10 text-[var(--text-2)]">{b.size}</span>
                      <span className="relative z-10 text-right text-[var(--text-3)]">{b.total}</span>
                      <span className="relative z-10 text-right font-medium text-[var(--up)]">${b.price.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Asks side (Low to High) */}
            <div>
              <div className="grid grid-cols-3 text-[9px] uppercase text-[var(--text-3)] border-b border-[var(--line)] pb-0.5 mb-1 px-1">
                <span className="text-[var(--down)]">Ask</span>
                <span className="text-right">Size</span>
                <span className="text-right">Total</span>
              </div>
              <div className="space-y-0.5">
                {depth.asks.map((a, i) => {
                  const widthPct = Math.min(100, Math.round((a.total / maxTotal) * 100));
                  return (
                    <div key={i} className="relative grid grid-cols-3 px-1 py-0.5 text-[10px] items-center">
                      <div
                        className="absolute left-0 top-0 bottom-0 bg-[var(--down)]/15 pointer-events-none rounded-[1px]"
                        style={{ width: `${widthPct}%` }}
                      />
                      <span className="relative z-10 font-medium text-[var(--down)]">${a.price.toFixed(2)}</span>
                      <span className="relative z-10 text-right text-[var(--text-2)]">{a.size}</span>
                      <span className="relative z-10 text-right text-[var(--text-3)]">{a.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-3 text-center bg-[var(--bg-1)]">
          <span className="text-[10px] uppercase font-mono text-[var(--text-3)] mb-1">Level 2 Book Locked</span>
          <p className="text-[11px] text-[var(--text-2)] font-sans max-w-[200px]">
            Detailed 5-level market depth unlocks at Rank 4 (Senior Trader).
          </p>
        </div>
      )}
    </div>
  );
}
