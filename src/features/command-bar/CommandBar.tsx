'use client';

import React, { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANIES, COMPANY_MAP } from '../../data/companies';
import { MagnifyingGlass, ArrowElbowDownLeft, ChartLine, Funnel, CalendarBlank, ShieldCheck, Question } from '@phosphor-icons/react';

type ParsedCommand =
  | { type: 'order'; side: 'buy' | 'sell'; ticker: string; quantity: number; limitPrice?: number; label: string }
  | { type: 'chart'; ticker: string; label: string }
  | { type: 'jump'; ticker: string; label: string }
  | { type: 'description'; ticker: string; label: string }
  | { type: 'screener'; label: string }
  | { type: 'calendar'; label: string }
  | { type: 'risk'; label: string }
  | { type: 'positions'; label: string }
  | { type: 'blotter'; label: string }
  | { type: 'news'; label: string }
  | { type: 'tutorial'; label: string };

export function CommandBar() {
  const open = useTerminalStore((s) => s.commandBarOpen);
  const setOpen = useTerminalStore((s) => s.setCommandBarOpen);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);
  const setActiveBottomTab = useTerminalStore((s) => s.setActiveBottomTab);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const restartTutorial = useTerminalStore((s) => s.restartTutorial);
  const placeOrder = useTerminalStore((s) => s.placeOrder);
  const addToast = useTerminalStore((s) => s.addToast);

  const [query, setQuery] = useState('');

  // Global key listener for '/' and 'Cmd+K' / 'Ctrl+K'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  // Parse command syntax inline:
  // e.g. "BUY HLVG 100", "SELL BWTR 50 @ 78.50", "HLVG GP", "HLVG DES", "SCR", "CAL", "RISK", "TUTORIAL"
  const parsedCommand = React.useMemo<ParsedCommand | null>(() => {
    const trimmed = query.trim().toUpperCase();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+/);
    const first = parts[0];

    // 1. Direct BUY or SELL command
    if ((first === 'BUY' || first === 'SELL') && parts.length >= 3) {
      const ticker = parts[1];
      const qty = parseInt(parts[2]);
      let limitPrice: number | undefined;

      // Check for "@ <price>" limit order syntax
      if (parts.length >= 5 && parts[3] === '@') {
        limitPrice = parseFloat(parts[4]);
      }

      if (COMPANY_MAP.has(ticker) && !isNaN(qty) && qty > 0) {
        return {
          type: 'order',
          side: first.toLowerCase() as 'buy' | 'sell',
          ticker,
          quantity: qty,
          limitPrice,
          label: `${first} ${qty} ${ticker} ${limitPrice ? `@ $${limitPrice.toFixed(2)} LIMIT` : 'MARKET'}`,
        };
      }
    }

    // 2. Mnemonic: "<TICKER> GP" -> Graph/Chart
    if (parts.length === 2 && parts[1] === 'GP' && COMPANY_MAP.has(parts[0])) {
      return {
        type: 'chart',
        ticker: parts[0],
        label: `Load ${parts[0]} Chart Pane`,
      };
    }

    // 3. Mnemonic: "<TICKER> DES" -> Description / Company profile
    if (parts.length === 2 && parts[1] === 'DES' && COMPANY_MAP.has(parts[0])) {
      return {
        type: 'description',
        ticker: parts[0],
        label: `Open ${parts[0]} Company Profile & Fundamentals`,
      };
    }

    // 4. Function mnemonics: SCR, CAL, RISK, POS, BLOT, N
    if (trimmed === 'SCR') return { type: 'screener', label: 'Open Stock Screener' };
    if (trimmed === 'CAL') return { type: 'calendar', label: 'Open Earnings Calendar' };
    if (trimmed === 'RISK') return { type: 'risk', label: 'Open Portfolio Risk Analytics' };
    if (trimmed === 'POS') return { type: 'positions', label: 'Switch to Positions Dock' };
    if (trimmed === 'BLOT') return { type: 'blotter', label: 'Switch to Trade Blotter' };
    if (trimmed === 'N') return { type: 'news', label: 'Scroll to Live Wire News' };
    if (trimmed === 'TUTORIAL') return { type: 'tutorial', label: 'Start Interactive Tutorial' };

    // 5. Direct ticker jump
    if (COMPANY_MAP.has(trimmed)) {
      return {
        type: 'jump',
        ticker: trimmed,
        label: `Jump to ${trimmed} (${COMPANY_MAP.get(trimmed)?.name})`,
      };
    }

    return null;
  }, [query]);

  const executeParsed = () => {
    if (!parsedCommand) return;

    if (parsedCommand.type === 'order') {
      placeOrder({
        ticker: parsedCommand.ticker,
        side: parsedCommand.side,
        type: parsedCommand.limitPrice ? 'limit' : 'market',
        quantity: parsedCommand.quantity,
        limitPrice: parsedCommand.limitPrice,
        timeInForce: 'DAY',
      });
    } else if (parsedCommand.type === 'chart' || parsedCommand.type === 'jump') {
      setSelectedTicker(parsedCommand.ticker);
    } else if (parsedCommand.type === 'description') {
      setActiveModal('company', parsedCommand.ticker);
    } else if (parsedCommand.type === 'screener') {
      setActiveModal('screener');
    } else if (parsedCommand.type === 'calendar') {
      setActiveBottomTab('calendar');
    } else if (parsedCommand.type === 'risk') {
      setActiveBottomTab('risk');
    } else if (parsedCommand.type === 'positions') {
      setActiveBottomTab('positions');
    } else if (parsedCommand.type === 'blotter') {
      setActiveBottomTab('blotter');
    } else if (parsedCommand.type === 'tutorial') {
      restartTutorial();
    }

    setOpen(false);
    setQuery('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-start justify-center pt-24 z-50 p-4 font-mono select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--accent)] rounded-[2px] max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Input Field */}
        <div className="flex items-center px-3 border-b border-[var(--line)] bg-[var(--bg-0)] h-10">
          <MagnifyingGlass size={14} weight="bold" className="text-[var(--accent)] mr-2 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsedCommand) {
                e.preventDefault();
                executeParsed();
              }
            }}
            placeholder="Type ticker, mnemonic (HLVG GP, SCR, RISK), or order (BUY HLVG 100)..."
            className="w-full bg-transparent text-[13px] text-[var(--text-1)] placeholder-[var(--text-3)] outline-none uppercase font-mono"
          />
          <kbd className="text-[10px] bg-[var(--bg-2)] border border-[var(--line)] px-1.5 py-0.5 rounded-[2px] text-[var(--text-2)] ml-2">
            ESC
          </kbd>
        </div>

        {/* Parsed Command Preview if syntax matches */}
        {parsedCommand && (
          <div
            onClick={executeParsed}
            className="bg-[var(--accent)]/15 border-b border-[var(--accent)] px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-[var(--accent)]/25"
          >
            <div className="flex items-center space-x-2">
              <span className="text-[10px] uppercase font-bold text-[var(--accent)] bg-[var(--bg-0)] px-1 py-0.5 rounded-[1px]">
                EXECUTABLE
              </span>
              <span className="text-[12px] font-semibold text-[var(--text-1)]">
                {parsedCommand.label}
              </span>
            </div>
            <div className="flex items-center space-x-1 text-[10px] text-[var(--accent)]">
              <span>Press Enter</span>
              <ArrowElbowDownLeft size={12} weight="bold" />
            </div>
          </div>
        )}

        {/* Suggested / Available Commands List */}
        <div className="max-h-64 overflow-y-auto p-1 divide-y divide-[var(--line)] text-[11px]">
          <div className="px-2 py-1 text-[9px] uppercase text-[var(--text-3)]">
            Suggested Tickers & Functions
          </div>

          {/* Quick jump tickers */}
          {COMPANIES.filter((c) => !query || c.ticker.includes(query.toUpperCase()) || c.name.toUpperCase().includes(query.toUpperCase()))
            .slice(0, 6)
            .map((c) => (
              <button
                key={c.ticker}
                onClick={() => {
                  setSelectedTicker(c.ticker);
                  setOpen(false);
                }}
                className="w-full px-2 py-1.5 flex items-center justify-between hover:bg-[var(--bg-2)] text-left cursor-pointer transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-[var(--text-1)]">{c.ticker}</span>
                  <span className="text-[var(--text-2)] text-[10px] truncate max-w-[200px]">{c.name}</span>
                </div>
                <span className="text-[var(--text-3)] text-[10px] uppercase">{c.sector}</span>
              </button>
            ))}

          {/* Mnemonics Guide */}
          <div className="p-2 text-[10px] text-[var(--text-3)] bg-[var(--bg-0)] space-y-1">
            <div className="font-bold text-[var(--text-2)] uppercase text-[9px]">Terminal Command Shortcuts</div>
            <div><span className="text-[var(--accent)]">TICKER GP</span>: Load chart (e.g. HLVG GP)</div>
            <div><span className="text-[var(--accent)]">TICKER DES</span>: Open company profile (e.g. KSTL DES)</div>
            <div><span className="text-[var(--accent)]">BUY/SELL TICKER QTY</span>: Execute instant market trade</div>
            <div><span className="text-[var(--accent)]">SCR</span>: Stock screener | <span className="text-[var(--accent)]">CAL</span>: Earnings calendar | <span className="text-[var(--accent)]">RISK</span>: Risk report</div>
          </div>
        </div>
      </div>
    </div>
  );
}
