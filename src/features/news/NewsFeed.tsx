'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { NewspaperClipping, Warning, ChartLineUp, ShieldWarning } from '@phosphor-icons/react';

export function NewsFeed() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);
  const newsList = snapshot?.activeNews || [];

  return (
    <div className="h-full flex flex-col bg-[var(--bg-1)] select-none text-[12px]" id="tutorial-news">
      {/* Header */}
      <div className="h-[28px] border-b border-[var(--line)] px-2.5 flex items-center justify-between shrink-0 bg-[var(--bg-1)]">
        <div className="flex items-center space-x-1.5">
          <NewspaperClipping size={13} weight="bold" className="text-[var(--text-3)]" />
          <span className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wider">
            Live Wire & Earnings ({newsList.length})
          </span>
        </div>
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--line)] p-1">
        {newsList.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[var(--text-3)] font-mono text-[11px]">
            <span>Awaiting scheduled reports and macro wires...</span>
          </div>
        ) : (
          newsList.map((item) => {
            const isEarnings = item.category === 'earnings';
            const isMacro = item.category === 'macro';
            const isBlackSwan = item.category === 'black_swan';
            const isPositive = item.trueImpact >= 0;

            return (
              <div
                key={item.id}
                onClick={() => item.ticker && setSelectedTicker(item.ticker)}
                className={`p-2 transition-colors cursor-pointer hover:bg-[var(--bg-2)] ${
                  isBlackSwan ? 'border-l-2 border-l-[var(--down)] bg-[var(--down)]/5' : ''
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-3)] mb-0.5">
                  <div className="flex items-center space-x-1.5">
                    {item.ticker && (
                      <span className="font-bold text-[var(--text-1)] px-1 py-0.2 rounded-[2px] bg-[var(--bg-2)] border border-[var(--line)]">
                        {item.ticker}
                      </span>
                    )}
                    <span className="uppercase text-[9px] text-[var(--text-2)]">
                      {isBlackSwan ? 'Black Swan Alert' : isEarnings ? 'Earnings Release' : isMacro ? 'Macroeconomic' : item.sector}
                    </span>
                  </div>

                  <span className="text-[9px]">
                    Day {item.simDay}
                  </span>
                </div>

                <div className="text-[11px] font-medium text-[var(--text-1)] leading-tight mt-1">
                  {item.headline}
                </div>

                <div className="text-[10px] text-[var(--text-3)] leading-normal mt-1 font-sans">
                  {item.body}
                </div>

                {item.isRumor && (
                  <div className="mt-1 text-[9px] font-mono text-[var(--accent)] flex items-center space-x-1">
                    <Warning size={10} weight="bold" />
                    <span>Unconfirmed desk rumor: High volatility expected</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
