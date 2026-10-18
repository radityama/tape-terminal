'use client';

import React, { useState, useMemo } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANIES, Sector, SECTORS } from '../../data/companies';
import { X, CaretUp, CaretDown, Funnel } from '@phosphor-icons/react';

export function ScreenerModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);
  const snapshot = useTerminalStore((s) => s.snapshot);

  const [sectorFilter, setSectorFilter] = useState<Sector | 'ALL'>('ALL');
  const [tierFilter, setTierFilter] = useState<string>('ALL');
  const [minPe, setMinPe] = useState<string>('');
  const [maxPe, setMaxPe] = useState<string>('');
  const [minYield, setMinYield] = useState<string>('');
  const [sortBy, setSortBy] = useState<'pe' | 'changePercent' | 'dividendYield' | 'beta' | 'marketCap'>('changePercent');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  if (activeModal !== 'screener') return null;

  const priceMap = new Map(snapshot?.prices.map((p) => [p.ticker, p]));

  const filtered = COMPANIES.filter((c) => {
    if (sectorFilter !== 'ALL' && c.sector !== sectorFilter) return false;
    if (tierFilter !== 'ALL' && c.marketCapTier !== tierFilter) return false;
    if (minPe && c.fundamentals.pe < parseFloat(minPe)) return false;
    if (maxPe && c.fundamentals.pe > parseFloat(maxPe)) return false;
    if (minYield && c.dividendYield * 100 < parseFloat(minYield)) return false;
    return true;
  }).sort((a, b) => {
    let valA = 0;
    let valB = 0;

    if (sortBy === 'pe') {
      valA = a.fundamentals.pe;
      valB = b.fundamentals.pe;
    } else if (sortBy === 'dividendYield') {
      valA = a.dividendYield;
      valB = b.dividendYield;
    } else if (sortBy === 'beta') {
      valA = a.beta;
      valB = b.beta;
    } else if (sortBy === 'marketCap') {
      valA = a.marketCap;
      valB = b.marketCap;
    } else if (sortBy === 'changePercent') {
      valA = priceMap.get(a.ticker)?.changePercent ?? 0;
      valB = priceMap.get(b.ticker)?.changePercent ?? 0;
    }

    return sortOrder === 'desc' ? valB - valA : valA - valB;
  });

  return (
    <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-4xl w-full h-[85vh] flex flex-col shadow-float overflow-hidden">
        {/* Modal Header */}
        <div className="h-10 border-b border-[var(--line)] px-4 flex items-center justify-between bg-[var(--bg-0)] shrink-0">
          <div className="flex items-center space-x-2">
            <Funnel size={14} weight="bold" className="text-[var(--accent)]" />
            <span className="font-bold font-mono text-[13px] text-[var(--text-1)]">
              Stock Screener & Fundamentals Filter ({filtered.length} matches)
            </span>
          </div>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1 rounded-[2px] hover:bg-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-3 border-b border-[var(--line)] bg-[var(--bg-1)] grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] font-mono shrink-0">
          <div>
            <label className="text-[9px] uppercase text-[var(--text-3)] block mb-1">Sector</label>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value as Sector | 'ALL')}
              className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 py-1 text-[var(--text-1)] outline-none"
            >
              <option value="ALL">All Sectors</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[9px] uppercase text-[var(--text-3)] block mb-1">Cap Tier</label>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 py-1 text-[var(--text-1)] outline-none"
            >
              <option value="ALL">All Tiers</option>
              <option value="mega">Mega Cap (&gt; $100B)</option>
              <option value="large">Large Cap ($40B - $100B)</option>
              <option value="mid">Mid Cap ($15B - $40B)</option>
              <option value="small">Small Cap (&lt; $15B)</option>
            </select>
          </div>

          <div>
            <label className="text-[9px] uppercase text-[var(--text-3)] block mb-1">Max P/E</label>
            <input
              type="number"
              placeholder="e.g. 25"
              value={maxPe}
              onChange={(e) => setMaxPe(e.target.value)}
              className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 py-1 text-[var(--text-1)] outline-none"
            >
            </input>
          </div>

          <div>
            <label className="text-[9px] uppercase text-[var(--text-3)] block mb-1">Min Yield (%)</label>
            <input
              type="number"
              step="0.5"
              placeholder="e.g. 2.5"
              value={minYield}
              onChange={(e) => setMinYield(e.target.value)}
              className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 py-1 text-[var(--text-1)] outline-none"
            >
            </input>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setSectorFilter('ALL');
                setTierFilter('ALL');
                setMinPe('');
                setMaxPe('');
                setMinYield('');
              }}
              className="w-full py-1 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Results Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left font-mono text-[11px] divide-y divide-[var(--line)]">
            <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
              <tr>
                <th className="py-2 px-3">Symbol / Company</th>
                <th className="py-2 px-2">Sector</th>
                <th className="py-2 px-2 text-right">Price</th>
                <th className="py-2 px-2 text-right cursor-pointer" onClick={() => { setSortBy('changePercent'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Chg %
                </th>
                <th className="py-2 px-2 text-right cursor-pointer" onClick={() => { setSortBy('marketCap'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Mkt Cap
                </th>
                <th className="py-2 px-2 text-right cursor-pointer" onClick={() => { setSortBy('pe'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  P/E
                </th>
                <th className="py-2 px-2 text-right cursor-pointer" onClick={() => { setSortBy('dividendYield'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Div Yield
                </th>
                <th className="py-2 px-2 text-right">Beta</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filtered.map((c) => {
                const p = priceMap.get(c.ticker);
                const curPrice = p?.price ?? c.initialPrice;
                const chgPct = p?.changePercent ?? 0;
                return (
                  <tr key={c.ticker} className="hover:bg-[var(--bg-2)] cursor-pointer">
                    <td className="py-2 px-3 font-semibold text-[var(--text-1)]">
                      <div className="flex items-center space-x-1.5">
                        <span>{c.ticker}</span>
                        <span className="text-[10px] text-[var(--text-3)] font-normal truncate max-w-[150px]">{c.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-[var(--text-2)] text-[10px]">{c.sector}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-1)]">${curPrice.toFixed(2)}</td>
                    <td className={`py-2 px-2 text-right font-medium ${chgPct >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                      {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-2)]">${c.marketCap.toFixed(1)}B</td>
                    <td className="py-2 px-2 text-right text-[var(--text-1)]">{c.fundamentals.pe > 0 ? c.fundamentals.pe.toFixed(1) : 'N/A'}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-2)]">{(c.dividendYield * 100).toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right text-[var(--text-3)]">{c.beta.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right space-x-1">
                      <button
                        onClick={() => {
                          setSelectedTicker(c.ticker);
                          setActiveModal('none');
                        }}
                        className="px-2 py-0.5 bg-[var(--bg-0)] hover:bg-[var(--accent)] hover:text-[var(--bg-0)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-1)] cursor-pointer"
                      >
                        Chart
                      </button>
                      <button
                        onClick={() => setActiveModal('company', c.ticker)}
                        className="px-2 py-0.5 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-2)] cursor-pointer"
                      >
                        Profile
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
