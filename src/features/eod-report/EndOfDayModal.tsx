'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { X, ChatCircleDots } from '@phosphor-icons/react';
import { Money } from '../../lib/money';
import type { TradeRecord } from '../../engine/matching';

// Closing fill P&L after the exit commission; entry fees are not allocated to closes.
const closingNet = (trade: TradeRecord) => Money.from(trade.realizedPnl ?? 0).sub(trade.commission).toNumber();
const signClass = (value: number) =>
  value > 0 ? 'text-[var(--up)]' : value < 0 ? 'text-[var(--down)]' : 'text-[var(--text-1)]';

export function EndOfDayModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const dismissEodReport = useTerminalStore((s) => s.dismissEodReport);
  const engine = useTerminalStore((s) => s.engine);

  if (activeModal !== 'eod') return null;

  const report = engine?.getCurrentEodModal();
  if (!report) return null;

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
        <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Opening Equity</span>
            <span className="text-[15px] font-bold text-[var(--text-1)]">
              {Money.from(report.startingEquity).format()}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Closing Net Equity</span>
            <span className="text-[15px] font-bold text-[var(--text-1)]">
              {Money.from(report.endingEquity).format()}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Session Net P&L</span>
            <span className={`text-[15px] font-bold ${signClass(report.netPnl)}`}>
              {Money.from(report.netPnl).format(true)}
              <span className="text-[11px] font-normal pl-1">
                ({report.returnPct === null ? 'N/A' : `${report.returnPct > 0 ? '+' : ''}${report.returnPct.toFixed(2)}%`})
              </span>
            </span>
          </div>
        </div>

        {/* Best & Worst Trade */}
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px]">
            <span className="text-[9px] uppercase text-[var(--text-3)] block font-bold">Best Trade</span>
            {report.bestTrade ? (
              <div className="mt-1">
                <div className="text-[12px] font-bold text-[var(--text-1)]">{report.bestTrade.ticker}</div>
                <div className={`text-[11px] font-semibold ${signClass(closingNet(report.bestTrade))}`}>
                  {Money.from(closingNet(report.bestTrade)).format(true)}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--text-3)] mt-1">No closed trades today</div>
            )}
          </div>

          <div className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px]">
            <span className="text-[9px] uppercase text-[var(--text-3)] block font-bold">Worst Trade</span>
            {report.worstTrade ? (
              <div className="mt-1">
                <div className="text-[12px] font-bold text-[var(--text-1)]">{report.worstTrade.ticker}</div>
                <div className={`text-[11px] font-semibold ${signClass(closingNet(report.worstTrade))}`}>
                  {Money.from(closingNet(report.worstTrade)).format(true)}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--text-3)] mt-1">No closed trades today</div>
            )}
          </div>
        </div>

        <p className="font-mono text-[9px] text-[var(--text-3)] leading-relaxed">
          Trade figures are closing fill P&L after exit commission; entry fees are not allocated. Sector P&L unavailable.
        </p>

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
