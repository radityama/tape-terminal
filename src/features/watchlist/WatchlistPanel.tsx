'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANIES, Company, Sector, SECTORS } from '../../data/companies';
import { MagnifyingGlass } from '@phosphor-icons/react';

// Price Cell with per-cell throttle, quantization, and calm overlay fade
export const WatchlistPriceCell = React.memo(function WatchlistPriceCell({
  ticker,
  initialPrice,
}: {
  ticker: string;
  initialPrice: number;
}) {
  const quote = useTerminalStore((s) => s.pricesByTicker[ticker]);
  const priceFlashSetting = useTerminalStore((s) => s.priceFlashSetting);

  const overlayRef = useRef<HTMLDivElement>(null);
  const lastFlashTimeRef = useRef<number>(0);
  const prevPriceRef = useRef<number>(quote?.price ?? initialPrice);
  const lastMoveDirectionRef = useRef<'up' | 'down'>(quote?.lastMoveDirection ?? 'up');

  // Display price quantized to $0.01
  const displayPrice = quote?.price ?? initialPrice;

  useEffect(() => {
    if (!quote) return;

    // 1. Quantize before comparing: round to asset's tick size ($0.01)
    const curPrice = Math.round(quote.price * 100) / 100;
    const prevPrice = prevPriceRef.current;

    // If the displayed price did not change, do nothing. No flash, no animation.
    if (curPrice === prevPrice) {
      return;
    }

    const isUp = curPrice > prevPrice;
    prevPriceRef.current = curPrice;
    lastMoveDirectionRef.current = isUp ? 'up' : 'down';

    // Honor prefers-reduced-motion by forcing Off
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (priceFlashSetting === 'off' || prefersReducedMotion) {
      return;
    }

    // 2. Per-cell flash throttle scaled with speed: 1x = 1500ms, 5x = 1000ms, 20x = 700ms
    const speed = useTerminalStore.getState().engine?.getSpeed() ?? 1;
    const cooldown = speed >= 20 ? 700 : speed >= 5 ? 1000 : 1500;

    const now = Date.now();
    if (now - lastFlashTimeRef.current >= cooldown) {
      lastFlashTimeRef.current = now;

      const overlay = overlayRef.current;
      if (overlay) {
        // Subtle (default): max 18% alpha (0.16); Full: 0.28
        const alpha = priceFlashSetting === 'full' ? 0.28 : 0.16;
        overlay.style.backgroundColor = isUp
          ? `rgba(61, 176, 112, ${alpha})`
          : `rgba(229, 83, 75, ${alpha})`;

        // Trigger 700ms cubic-bezier opacity fade via CSS class toggle on ref (no useState)
        overlay.classList.remove('cell-flash-active');
        void overlay.offsetWidth; // trigger DOM reflow to restart CSS animation
        overlay.classList.add('cell-flash-active');
      }
    }
  }, [quote, priceFlashSetting]);

  const lastMoveDir = quote?.lastMoveDirection ?? 'up';

  return (
    <div className="col-span-3 text-right font-medium text-[var(--text-1)] relative px-1 py-0.5 flex items-center justify-end space-x-1">
      {/* Calm overlay flash container: only animates opacity, never background-color on row */}
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none rounded-[1px] opacity-0"
      />
      {/* Direction triangle glyph: updates with last move, does not animate */}
      <span
        className={`text-[8px] select-none ${
          lastMoveDir === 'up' ? 'text-[var(--up)]' : 'text-[var(--down)]'
        }`}
      >
        {lastMoveDir === 'up' ? '▲' : '▼'}
      </span>
      <span className="relative z-10 font-mono">${displayPrice.toFixed(2)}</span>
    </div>
  );
});

// Change % Cell: persistent text color by sign, NO background flash, NO pulsing
export const WatchlistChangeCell = React.memo(function WatchlistChangeCell({
  ticker,
}: {
  ticker: string;
}) {
  const quote = useTerminalStore((s) => s.pricesByTicker[ticker]);
  const changePct = quote?.changePercent ?? 0;
  const isUp = changePct >= 0;

  return (
    <div
      className={`col-span-3 text-right font-medium flex items-center justify-end space-x-0.5 ${
        isUp ? 'text-[var(--up)]' : 'text-[var(--down)]'
      }`}
    >
      <span>{isUp ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`}</span>
    </div>
  );
});

// Volume Cell
export const WatchlistVolumeCell = React.memo(function WatchlistVolumeCell({
  ticker,
  initialVolume,
}: {
  ticker: string;
  initialVolume: number;
}) {
  const quote = useTerminalStore((s) => s.pricesByTicker[ticker]);
  const volume = quote?.volume ?? initialVolume;

  return (
    <div className="col-span-2 text-right text-[10px] text-[var(--text-3)] font-mono">
      {volume > 1000000 ? `${(volume / 1000000).toFixed(1)}M` : `${Math.floor(volume / 1000)}k`}
    </div>
  );
});

// Memoized Watchlist Row
export const WatchlistRow = React.memo(function WatchlistRow({
  company,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  company: Company;
  isSelected: boolean;
  onSelect: (ticker: string) => void;
  onContextMenu: (e: React.MouseEvent, ticker: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(company.ticker)}
      onContextMenu={(e) => onContextMenu(e, company.ticker)}
      className={`grid grid-cols-12 px-2 py-1 items-center font-mono text-[11px] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-2)] border-l-2 border-l-[var(--accent)]'
          : 'hover:bg-[var(--bg-2)] border-l-2 border-l-transparent'
      }`}
    >
      {/* Symbol + Sector Tag */}
      <div className="col-span-4 flex flex-col leading-tight overflow-hidden pr-1">
        <span className="font-semibold text-[var(--text-1)]">{company.ticker}</span>
        <span className="text-[9px] text-[var(--text-3)] truncate">{company.name}</span>
      </div>

      {/* Price Cell with calm overlay */}
      <WatchlistPriceCell ticker={company.ticker} initialPrice={company.initialPrice} />

      {/* Change % Cell */}
      <WatchlistChangeCell ticker={company.ticker} />

      {/* Volume Cell */}
      <WatchlistVolumeCell ticker={company.ticker} initialVolume={company.averageDailyVolume} />
    </div>
  );
});

export function WatchlistPanel() {
  const selectedTicker = useTerminalStore((s) => s.selectedTicker);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const addPriceAlert = useTerminalStore((s) => s.addPriceAlert);

  const [search, setSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState<Sector | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<'ticker' | 'price' | 'changePercent' | 'volume'>('changePercent');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ticker: string } | null>(null);

  // Filtered and sorted companies
  const filteredCompanies = useMemo(() => {
    const prices = useTerminalStore.getState().pricesByTicker;

    return COMPANIES.filter((comp) => {
      const matchSearch =
        comp.ticker.toLowerCase().includes(search.toLowerCase()) ||
        comp.name.toLowerCase().includes(search.toLowerCase());
      const matchSector = selectedSector === 'ALL' || comp.sector === selectedSector;
      return matchSearch && matchSector;
    }).sort((a, b) => {
      const pA = prices[a.ticker];
      const pB = prices[b.ticker];

      let valA = 0;
      let valB = 0;

      if (sortBy === 'ticker') {
        return sortOrder === 'asc' ? a.ticker.localeCompare(b.ticker) : b.ticker.localeCompare(a.ticker);
      } else if (sortBy === 'price') {
        valA = pA?.price || a.initialPrice;
        valB = pB?.price || b.initialPrice;
      } else if (sortBy === 'changePercent') {
        valA = pA?.changePercent || 0;
        valB = pB?.changePercent || 0;
      } else if (sortBy === 'volume') {
        valA = pA?.volume || a.averageDailyVolume;
        valB = pB?.volume || b.averageDailyVolume;
      }

      return sortOrder === 'desc' ? valB - valA : valA - valB;
    });
  }, [search, selectedSector, sortBy, sortOrder]);

  const handleSort = (field: 'ticker' | 'price' | 'changePercent' | 'volume') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, ticker: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, ticker });
  };

  return (
    <div
      className="h-full flex flex-col bg-[var(--bg-1)] select-none text-[12px]"
      id="tutorial-watchlist"
      onClick={() => contextMenu && setContextMenu(null)}
    >
      {/* Panel Header */}
      <div className="h-[28px] border-b border-[var(--line)] px-2.5 flex items-center justify-between shrink-0 bg-[var(--bg-1)]">
        <span className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wider">
          Watchlist ({filteredCompanies.length})
        </span>

        {/* Sector Filter Dropdown */}
        <select
          value={selectedSector}
          onChange={(e) => setSelectedSector(e.target.value as Sector | 'ALL')}
          className="bg-[var(--bg-2)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-2)] px-1 py-0.5 outline-none cursor-pointer"
        >
          <option value="ALL">All Sectors</option>
          {SECTORS.map((sec) => (
            <option key={sec} value={sec}>{sec}</option>
          ))}
        </select>
      </div>

      {/* Filter search bar */}
      <div className="p-1.5 border-b border-[var(--line)] bg-[var(--bg-1)]">
        <div className="relative">
          <MagnifyingGlass size={12} weight="bold" className="absolute left-2 top-2 text-[var(--text-3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or company..."
            className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] text-[11px] pl-6 pr-2 py-1 text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 px-2 py-1 border-b border-[var(--line)] text-[10px] uppercase font-mono text-[var(--text-3)] bg-[var(--bg-0)] shrink-0">
        <button
          onClick={() => handleSort('ticker')}
          className="col-span-4 text-left hover:text-[var(--text-1)] cursor-pointer flex items-center space-x-0.5"
        >
          <span>Symbol</span>
        </button>
        <button
          onClick={() => handleSort('price')}
          className="col-span-3 text-right hover:text-[var(--text-1)] cursor-pointer"
        >
          <span>Last</span>
        </button>
        <button
          onClick={() => handleSort('changePercent')}
          className="col-span-3 text-right hover:text-[var(--text-1)] cursor-pointer"
        >
          <span>Chg %</span>
        </button>
        <button
          onClick={() => handleSort('volume')}
          className="col-span-2 text-right hover:text-[var(--text-1)] cursor-pointer"
        >
          <span>Vol</span>
        </button>
      </div>

      {/* Rows Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--line)]">
        {filteredCompanies.map((comp) => (
          <WatchlistRow
            key={comp.ticker}
            company={comp}
            isSelected={selectedTicker === comp.ticker}
            onSelect={setSelectedTicker}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[var(--bg-2)] border border-[var(--line-strong)] shadow-lg rounded-[2px] py-1 text-[11px] z-50 w-36 font-sans"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 font-mono font-semibold text-[var(--text-3)] border-b border-[var(--line)]">
            {contextMenu.ticker}
          </div>
          <button
            onClick={() => {
              setSelectedTicker(contextMenu.ticker);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1 hover:bg-[var(--line)] text-[var(--text-1)] cursor-pointer"
          >
            Load in Chart
          </button>
          <button
            onClick={() => {
              setActiveModal('company', contextMenu.ticker);
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1 hover:bg-[var(--line)] text-[var(--text-1)] cursor-pointer"
          >
            Company Profile
          </button>
          <button
            onClick={() => {
              const cur = useTerminalStore.getState().pricesByTicker[contextMenu.ticker]?.price || 100;
              addPriceAlert(contextMenu.ticker, cur * 1.05, 'above');
              setContextMenu(null);
            }}
            className="w-full text-left px-2 py-1 hover:bg-[var(--line)] text-[var(--text-1)] cursor-pointer"
          >
            Add +5% Alert
          </button>
        </div>
      )}
    </div>
  );
}
