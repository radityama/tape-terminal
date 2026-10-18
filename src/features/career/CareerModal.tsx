'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { CAREER_RANKS } from '../../engine/career';
import { X, Trophy, CheckCircle, WarningCircle, User } from '@phosphor-icons/react';

export function CareerModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const snapshot = useTerminalStore((s) => s.snapshot);

  if (activeModal !== 'career' || !snapshot) return null;

  const career = snapshot.career;
  const currentRank = career.rank;
  const nextRank = career.nextRank;
  const risk = snapshot.riskMetrics;
  const blotter = snapshot.recentTrades;

  // Compute career stats from blotter
  const closedTrades = blotter.filter((t) => t.realizedPnl !== undefined);
  const winTrades = closedTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0;

  const grossProfit = winTrades.reduce((acc, t) => acc + (t.realizedPnl ?? 0), 0);
  const lossTrades = closedTrades.filter((t) => (t.realizedPnl ?? 0) < 0);
  const grossLoss = Math.abs(lossTrades.reduce((acc, t) => acc + (t.realizedPnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'Inf' : '0.00';

  return (
    <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-3xl w-full h-[85vh] flex flex-col shadow-float overflow-hidden">
        {/* Header */}
        <div className="h-10 border-b border-[var(--line)] px-4 flex items-center justify-between bg-[var(--bg-0)] shrink-0">
          <div className="flex items-center space-x-2">
            <User size={15} weight="bold" className="text-[var(--accent)]" />
            <span className="font-bold font-mono text-[13px] text-[var(--text-1)]">
              Trader Career Profile & Progression
            </span>
          </div>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1 rounded-[2px] hover:bg-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Current Rank Banner */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase font-mono text-[var(--text-3)]">Current Professional Rank</div>
              <div className="text-[18px] font-bold font-mono text-[var(--accent)] mt-0.5">
                {currentRank.name} (Rank {currentRank.order} of 6)
              </div>
              <p className="text-[11px] text-[var(--text-2)] mt-1 max-w-lg">
                {currentRank.description}
              </p>
            </div>

            <div className="bg-[var(--bg-1)] border border-[var(--line)] p-2 rounded-[2px] font-mono text-[11px] text-right shrink-0">
              <div className="text-[9px] uppercase text-[var(--text-3)]">Reputation Score</div>
              <div className="text-[16px] font-bold text-[var(--text-1)]">{career.reputation} pts</div>
              <div className="text-[9px] text-[var(--text-3)] mt-0.5">Earned from objectives</div>
            </div>
          </div>

          {/* Next Rank Progress */}
          {nextRank ? (
            <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-2 font-mono text-[11px]">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[var(--text-2)]">Next Promotion: <strong className="text-[var(--text-1)]">{nextRank.name}</strong></span>
                <span className="text-[var(--accent)]">Target: ${nextRank.equityTarget.toLocaleString()} Equity</span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-[var(--bg-2)] rounded-[1px] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{
                    width: `${Math.min(100, Math.max(0, (risk.netLiquidationValue / nextRank.equityTarget) * 100))}%`,
                  }}
                />
              </div>

              <div className="flex justify-between text-[10px] text-[var(--text-3)]">
                <span>Account Equity: ${risk.netLiquidationValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span>Max Drawdown Limit: {nextRank.maxDrawdownPercent}%</span>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--accent)]/10 border border-[var(--accent)] p-3 rounded-[2px] text-[12px] font-mono text-[var(--accent)]">
              Highest Career Rank Achieved: Master Fund Manager
            </div>
          )}

          {/* Performance Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
            <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
              <div className="text-[9px] uppercase text-[var(--text-3)]">Win Rate</div>
              <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">{winRate.toFixed(1)}%</div>
            </div>
            <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
              <div className="text-[9px] uppercase text-[var(--text-3)]">Profit Factor</div>
              <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">{profitFactor}</div>
            </div>
            <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
              <div className="text-[9px] uppercase text-[var(--text-3)]">Closed Trades</div>
              <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">{closedTrades.length}</div>
            </div>
            <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
              <div className="text-[9px] uppercase text-[var(--text-3)]">Risk Reviews</div>
              <div className={`text-[14px] font-bold mt-0.5 ${career.riskBreaches > 0 ? 'text-[var(--down)]' : 'text-[var(--up)]'}`}>
                {career.riskBreaches} of 3
              </div>
            </div>
          </div>

          {/* Weekly Objectives */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-[var(--text-3)]">
              Rotating Weekly Objectives
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {career.objectives.map((obj) => (
                <div key={obj.id} className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px] flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                      <span className="font-mono font-semibold text-[11px] text-[var(--text-1)]">{obj.title}</span>
                      <span className="text-[10px] font-mono text-[var(--accent)] font-bold">+{obj.reputationReward} pts</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-3)] mt-1 font-sans">{obj.description}</p>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-[var(--text-2)] flex items-center space-x-1">
                    <span className="text-[var(--accent)]">{obj.progressText}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements Grid */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-[var(--text-3)]">
              Career Achievements
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {career.achievements.map((ach) => (
                <div
                  key={ach.id}
                  className={`p-2.5 border rounded-[2px] transition-colors ${
                    ach.unlocked
                      ? 'bg-[var(--bg-0)] border-[var(--accent)]'
                      : 'bg-[var(--bg-0)]/50 border-[var(--line)] opacity-50'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 mb-1">
                    <Trophy size={13} weight="bold" className={ach.unlocked ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'} />
                    <span className="font-mono font-semibold text-[11px] text-[var(--text-1)]">{ach.title}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-3)] font-sans">{ach.description}</p>
                  {ach.unlocked && (
                    <div className="mt-1 text-[9px] font-mono text-[var(--up)]">Unlocked</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
