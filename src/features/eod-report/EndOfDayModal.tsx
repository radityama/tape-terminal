'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { X, CaretUp, CaretDown, ChatCircleDots } from '@phosphor-icons/react';

export function EndOfDayModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const dismissEodReport = useTerminalStore((s) => s.dismissEodReport);
  const engine = useTerminalStore((s) => s.engine);

  if (activeModal !== 'eod') return null;

  const report = engine?.getCurrentEodModal();
  if (!report) return null;

  const isProfit = report.netPnl >= 0;

  return (
    <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-lg w-full p-4 space-y-4 shadow-float">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-[var(--line)] pb-2">
          <div>
            <div className="font-mono text-[10px] uppercase text-[var(--accent)] font-semibold">
              Daily Settlement Review
            </div>
            <h2 className="text-[16px] font-bold text-[var(--text-1)] font-mono">
              End of Day Report: {report.dateStr}
            </h2>
          </div>
          <button
            onClick={dismissEodReport}
            className="p-1 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* P&L Attribution Summary */}
        <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Closing Net Equity</span>
            <span className="text-[15px] font-bold text-[var(--text-1)]">
              ${report.endingEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Session Net P&L</span>
            <span className={`text-[15px] font-bold ${isProfit ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
              {isProfit ? `+$${report.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(report.netPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              <span className="text-[11px] font-normal pl-1">({isProfit ? '+' : ''}{report.returnPct.toFixed(2)}%)</span>
            </span>
          </div>
        </div>

        {/* Best & Worst Trade */}
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px]">
            <span className="text-[9px] uppercase text-[var(--up)] block font-bold">Best Trade</span>
            {report.bestTrade ? (
              <div className="mt-1">
                <div className="text-[12px] font-bold text-[var(--text-1)]">{report.bestTrade.ticker}</div>
                <div className="text-[11px] text-[var(--up)] font-semibold">+${report.bestTrade.realizedPnl?.toFixed(2)}</div>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--text-3)] mt-1">No closed gains today</div>
            )}
          </div>

          <div className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px]">
            <span className="text-[9px] uppercase text-[var(--down)] block font-bold">Worst Trade</span>
            {report.worstTrade ? (
              <div className="mt-1">
                <div className="text-[12px] font-bold text-[var(--text-1)]">{report.worstTrade.ticker}</div>
                <div className="text-[11px] text-[var(--down)] font-semibold">-${Math.abs(report.worstTrade.realizedPnl || 0).toFixed(2)}</div>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--text-3)] mt-1">No closed losses today</div>
            )}
          </div>
        </div>

        {/* Performance Coach Note */}
        <div className="bg-[var(--bg-2)] p-3 border border-[var(--line-strong)] rounded-[2px] flex items-start space-x-2.5">
          <ChatCircleDots size={18} weight="bold" className="text-[var(--accent)] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] font-mono uppercase text-[var(--accent)] font-semibold">
              Senior Desk Coach Feedback
            </div>
            <p className="text-[12px] text-[var(--text-2)] leading-relaxed mt-1">
              {report.coachNote}
            </p>
          </div>
        </div>

        {/* Dismiss Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={dismissEodReport}
            className="px-4 py-1.5 bg-[var(--accent)] hover:brightness-105 text-[var(--bg-0)] font-semibold font-mono text-[11px] rounded-[2px] cursor-pointer"
          >
            Continue Trading (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
