'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { CaretUp, CaretDown } from '@phosphor-icons/react';

export function TapeTicker() {
  const tapeStripEnabled = useTerminalStore((s) => s.tapeStripEnabled);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);

  if (!tapeStripEnabled || !snapshot) return null;

  const tape50 = snapshot.tape50;
  const sectorIndices = snapshot.sectorIndices || [];
  const topPrices = snapshot.prices.slice(0, 16);

  return (
    <div 
      className="h-[22px] bg-[var(--bg-1)] border-b border-[var(--line)] flex items-center overflow-hidden text-[11px] font-mono select-none"
      role="region"
      aria-label="Market Ticker Tape"
    >
      <div className="flex items-center px-2 shrink-0 bg-[var(--bg-2)] border-r border-[var(--line)] text-[var(--accent)] font-semibold tracking-wider text-[10px]">
        TAPE
      </div>

      <div className="flex items-center whitespace-nowrap overflow-x-hidden hover:pause animate-[marquee_40s_linear_infinite] motion-reduce:animate-none space-x-6 px-4">
        {/* TAPE50 Index */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <span className="text-[var(--text-1)] font-semibold">TAPE50</span>
          <span className="text-[var(--text-2)]">{tape50.value.toFixed(2)}</span>
          <span className={`flex items-center ${tape50.change >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
            {tape50.change >= 0 ? <CaretUp weight="bold" size={10} /> : <CaretDown weight="bold" size={10} />}
            {tape50.changePercent >= 0 ? `+${tape50.changePercent.toFixed(2)}%` : `${tape50.changePercent.toFixed(2)}%`}
          </span>
        </div>

        <span className="text-[var(--line-strong)]">|</span>

        {/* Sector Indices */}
        {sectorIndices.map((sec) => (
          <div key={sec.symbol} className="flex items-center space-x-1 shrink-0">
            <span className="text-[var(--text-3)]">{sec.symbol}</span>
            <span className={`flex items-center ${sec.change >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
              {sec.change >= 0 ? '+' : ''}{sec.changePercent.toFixed(2)}%
            </span>
          </div>
        ))}

        <span className="text-[var(--line-strong)]">|</span>

        {/* Stock prices */}
        {topPrices.map((item) => (
          <button
            key={item.ticker}
            onClick={() => setSelectedTicker(item.ticker)}
            className="flex items-center space-x-1 shrink-0 hover:text-[var(--accent)] cursor-pointer"
          >
            <span className="text-[var(--text-1)] font-medium">{item.ticker}</span>
            <span className="text-[var(--text-2)]">${item.price.toFixed(2)}</span>
            <span className={`flex items-center ${item.change >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
              {item.change >= 0 ? <CaretUp weight="bold" size={10} /> : <CaretDown weight="bold" size={10} />}
              {item.changePercent >= 0 ? `+${item.changePercent.toFixed(2)}%` : `${item.changePercent.toFixed(2)}%`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
