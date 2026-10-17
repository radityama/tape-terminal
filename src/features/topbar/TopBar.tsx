'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { SimSpeed } from '../../engine/market';
import { UserMenuButton } from '../auth/SyncIndicator';
import {
  Play,
  Pause,
  FastForward,
  MagnifyingGlass,
  CalendarBlank,
  User,
  Gear,
  Question,
  Funnel,
  SkipForward,
} from '@phosphor-icons/react';

export function TopBar() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const engine = useTerminalStore((s) => s.engine);
  const setSimSpeed = useTerminalStore((s) => s.setSimSpeed);
  const setCommandBarOpen = useTerminalStore((s) => s.setCommandBarOpen);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const restartTutorial = useTerminalStore((s) => s.restartTutorial);
  const skipToNextDay = useTerminalStore((s) => s.skipToNextDay);

  if (!snapshot) return null;

  const speed = engine ? engine.getSpeed() : 1;
  const risk = snapshot.riskMetrics;
  const isRegular = snapshot.session === 'regular';
  const isPreMarket = snapshot.session === 'pre_market';

  // Day P&L
  const dayPnl = risk.netLiquidationValue - 100000;
  const dayPnlPercent = 100000 > 0 ? (dayPnl / 100000) * 100 : 0;
  const isPnlPositive = dayPnl >= 0;

  return (
    <header className="h-[44px] bg-[var(--bg-1)] border-b border-[var(--line)] px-3 flex items-center justify-between select-none text-[13px] z-30">
      {/* Left: Brand + Session Status + Sim Clock */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <span className="font-bold tracking-tight text-[15px] text-[var(--text-1)]">TAPE</span>
          <span className="text-[10px] uppercase font-mono px-1 py-0.5 rounded-[2px] bg-[var(--bg-2)] text-[var(--accent)] border border-[var(--line-strong)]">
            STOCKS
          </span>
        </div>

        <div className="h-4 w-[1px] bg-[var(--line)]" />

        {/* Real semantic session indicator */}
        <div className="flex items-center space-x-1.5 text-[11px] font-mono text-[var(--text-2)]" id="tutorial-sim-clock">
          <span 
            className={`w-2 h-2 rounded-[2px] ${
              isRegular ? 'bg-[var(--up)]' : isPreMarket ? 'bg-[var(--accent)]' : 'bg-[var(--text-3)]'
            }`}
            title={isRegular ? 'Regular Trading Session' : isPreMarket ? 'Pre-Market Session' : 'Market Closed'}
          />
          <span className="uppercase text-[10px]">
            {snapshot.session.replace('_', ' ')}
          </span>
          <span className="text-[var(--text-1)] font-semibold text-[12px] pl-1">
            Day {snapshot.simDay} {snapshot.simTimeStr}
          </span>
        </div>

        {/* Speed Controls */}
        <div className="flex items-center space-x-0.5 bg-[var(--bg-0)] p-0.5 rounded-[2px] border border-[var(--line)]">
          <button
            onClick={() => setSimSpeed(0)}
            className={`px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono flex items-center space-x-1 transition-colors cursor-pointer ${
              speed === 0 ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
            title="Pause simulation (Space)"
            aria-label="Pause simulation"
          >
            <Pause size={10} weight="bold" />
            <span className="hidden sm:inline">PAUSE</span>
          </button>
          <button
            onClick={() => setSimSpeed(1)}
            className={`px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono flex items-center space-x-1 transition-colors cursor-pointer ${
              speed === 1 ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
            title="1x Normal speed"
            aria-label="Normal speed"
          >
            <Play size={10} weight="bold" />
            <span>1X</span>
          </button>
          <button
            onClick={() => setSimSpeed(5)}
            className={`hidden sm:flex px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono items-center space-x-1 transition-colors cursor-pointer ${
              speed === 5 ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
            title="5x Fast speed"
            aria-label="5x Fast speed"
          >
            <FastForward size={10} weight="bold" />
            <span>5X</span>
          </button>
          <button
            onClick={() => setSimSpeed(20)}
            className={`hidden md:flex px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono items-center space-x-1 transition-colors cursor-pointer ${
              speed === 20 ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
            title="20x Turbo speed"
            aria-label="20x Turbo speed"
          >
            <span>20X</span>
          </button>
          <button
            onClick={skipToNextDay}
            className="hidden sm:flex px-1.5 py-0.5 rounded-[2px] text-[10px] font-mono items-center space-x-1 text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
            title="Skip to next session close"
            aria-label="Skip to next session close"
          >
            <SkipForward size={10} weight="bold" />
            <span>EOD</span>
          </button>
        </div>
      </div>

      {/* Center: Command Bar Quick Button */}
      <div className="hidden md:flex flex-1 max-w-[320px] mx-4" id="tutorial-command-bar">
        <button
          onClick={() => setCommandBarOpen(true)}
          className="w-full h-[26px] bg-[var(--bg-0)] hover:bg-[var(--bg-2)] border border-[var(--line)] hover:border-[var(--line-strong)] rounded-[2px] px-2.5 flex items-center justify-between text-[11px] text-[var(--text-3)] cursor-pointer transition-colors"
          title="Press / or Cmd+K to open Bloomberg-style command terminal"
          aria-label="Search or enter trading command"
        >
          <div className="flex items-center space-x-1.5">
            <MagnifyingGlass size={12} weight="bold" className="text-[var(--text-3)]" />
            <span className="text-[var(--text-2)]">Type ticker or function (e.g. HLVG, SCR)...</span>
          </div>
          <kbd className="text-[10px] font-mono bg-[var(--bg-1)] border border-[var(--line)] px-1 py-0.2 rounded-[2px] text-[var(--text-2)]">
            /
          </kbd>
        </button>
      </div>

      {/* Right: Portfolio Metrics + Action Modals */}
      <div className="flex items-center space-x-4">
        {/* Margin Warning Pill if cushion <= 35% */}
        {risk.isMarginWarning && (
          <div className="bg-[var(--down)]/20 border border-[var(--down)] text-[var(--down)] px-2 py-0.5 rounded-[2px] text-[10px] font-mono flex items-center space-x-1">
            <span>MARGIN CUSHION {risk.marginCushionPercent.toFixed(1)}%</span>
          </div>
        )}

        {/* Equity Figures */}
        <div className="text-right">
          <div className="text-[10px] text-[var(--text-3)] uppercase font-mono tracking-wider">
            Net Liquidation
          </div>
          <div className="font-mono text-[18px] font-bold tracking-tight text-[var(--text-1)] leading-none">
            ${risk.netLiquidationValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Day P&L */}
        <div className="text-right pl-1">
          <div className="text-[10px] text-[var(--text-3)] uppercase font-mono tracking-wider">
            Day P&L
          </div>
          <div className={`font-mono text-[13px] font-semibold leading-none ${isPnlPositive ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
            {isPnlPositive ? `+$${dayPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(dayPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            <span className="text-[10px] font-normal pl-1">
              ({isPnlPositive ? '+' : ''}{dayPnlPercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        <div className="h-4 w-[1px] bg-[var(--line)]" />

        {/* Modal Buttons */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveModal('screener')}
            className="p-1.5 rounded-[2px] bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] border border-[var(--line)] cursor-pointer"
            title="Stock Screener"
            aria-label="Stock Screener"
          >
            <Funnel size={14} weight="bold" />
          </button>

          <button
            onClick={() => setActiveModal('career')}
            className="p-1.5 rounded-[2px] bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] border border-[var(--line)] cursor-pointer"
            title="Career Ladder & Objectives"
            aria-label="Career Ladder & Objectives"
          >
            <User size={14} weight="bold" />
          </button>

          <button
            onClick={() => setActiveModal('settings')}
            className="p-1.5 rounded-[2px] bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] border border-[var(--line)] cursor-pointer"
            title="Settings & Saves"
            aria-label="Settings & Saves"
          >
            <Gear size={14} weight="bold" />
          </button>

          <button
            onClick={restartTutorial}
            className="p-1.5 rounded-[2px] bg-[var(--bg-2)] hover:bg-[var(--accent)] text-[var(--text-2)] hover:text-black border border-[var(--line)] cursor-pointer transition-colors"
            title="Replay Interactive Tutorial"
            aria-label="Replay Tutorial"
          >
            <Question size={14} weight="bold" />
          </button>

          <UserMenuButton />
        </div>
      </div>
    </header>
  );
}
