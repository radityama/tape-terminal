'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { COMPANY_MAP } from '../../data/companies';
import { X, ChartLine } from '@phosphor-icons/react';

export function CompanyModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const companyModalTicker = useTerminalStore((s) => s.companyModalTicker);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);
  const snapshot = useTerminalStore((s) => s.snapshot);

  if (activeModal !== 'company' || !companyModalTicker) return null;

  const company = COMPANY_MAP.get(companyModalTicker);
  if (!company) return null;

  const priceObj = snapshot?.prices.find((p) => p.ticker === company.ticker);
  const currentPrice = priceObj?.price ?? company.initialPrice;
  const f = company.fundamentals;

  // Derive realistic Wall Street analyst consensus from valuation & growth fundamentals
  let analystConsensus = 'NEUTRAL / HOLD';
  let targetPrice = f.fairValue;
  if (currentPrice < f.fairValue * 0.85 && f.pe > 0 && f.pe < 25) {
    analystConsensus = 'STRONG BUY / CONVICTION';
  } else if (currentPrice < f.fairValue * 0.95) {
    analystConsensus = 'OUTPERFORM / BUY';
  } else if (currentPrice > f.fairValue * 1.25 || f.pe > 60) {
    analystConsensus = 'UNDERPERFORM / REDUCE';
  }

  // Related news
  const relatedNews = (snapshot?.activeNews || []).filter((n) => n.ticker === company.ticker);

  return (
    <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-2xl w-full p-4 space-y-4 shadow-float">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-[var(--line)] pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-[18px] font-bold text-[var(--text-1)]">{company.ticker}</span>
              <span className="text-[12px] font-mono px-1.5 py-0.5 rounded-[2px] bg-[var(--bg-0)] text-[var(--accent)] border border-[var(--line)]">
                {company.sector}
              </span>
              <span className="text-[11px] font-mono text-[var(--text-3)] uppercase">
                {company.marketCapTier} cap (${company.marketCap.toFixed(1)}B)
              </span>
            </div>
            <h2 className="text-[14px] text-[var(--text-2)] font-medium mt-0.5">{company.name}</h2>
          </div>

          <button
            onClick={() => setActiveModal('none')}
            className="p-1 text-[var(--text-3)] hover:text-[var(--text-1)] rounded-[2px] cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Business Description */}
        <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] text-[12px] text-[var(--text-2)] leading-relaxed">
          {company.description}
        </div>

        {/* Fundamentals & Analyst Rating Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Price to Earnings (P/E)</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">{f.pe > 0 ? f.pe.toFixed(1) : 'Negative'}</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Annual Revenue</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">${f.revenue.toFixed(1)}B</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Diluted EPS</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">${f.eps.toFixed(2)}</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Debt to Equity</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">{f.debtToEquity.toFixed(2)}</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Dividend Yield</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">{(company.dividendYield * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Float Short Interest</div>
            <div className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">{(company.shortInterest * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Borrow Rate</div>
            <div className={`text-[13px] font-bold mt-0.5 ${company.hardToBorrow ? 'text-[var(--down)]' : 'text-[var(--text-1)]'}`}>
              {(company.borrowCostRate * 100).toFixed(1)}% {company.hardToBorrow ? '(Hard to Borrow)' : ''}
            </div>
          </div>
          <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
            <div className="text-[9px] uppercase text-[var(--text-3)]">Fundamental Fair Value</div>
            <div className="text-[13px] font-bold text-[var(--accent)] mt-0.5">${f.fairValue.toFixed(2)}</div>
          </div>
        </div>

        {/* Analyst Consensus Banner */}
        <div className="bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] p-2.5 flex items-center justify-between font-mono text-[11px]">
          <div>
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Institutional Consensus</span>
            <span className="font-bold text-[var(--text-1)] text-[12px]">{analystConsensus}</span>
          </div>
          <div className="text-right">
            <span className="text-[9px] uppercase text-[var(--text-3)] block">Fair Value Benchmark</span>
            <span className="font-semibold text-[var(--accent)]">${targetPrice.toFixed(2)}</span>
          </div>
        </div>

        {/* Related News Wire */}
        <div className="space-y-1.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase text-[var(--text-3)] border-b border-[var(--line)] pb-1">
            Recent Wire Coverage ({relatedNews.length})
          </div>
          {relatedNews.length === 0 ? (
            <div className="text-[var(--text-3)] text-[11px] py-1">No recent wire headlines for {company.ticker}.</div>
          ) : (
            relatedNews.map((n) => (
              <div key={n.id} className="p-1.5 bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px]">
                <div className="text-[11px] font-medium text-[var(--text-1)]">{n.headline}</div>
                <div className="text-[10px] text-[var(--text-3)] mt-0.5 font-sans">{n.body}</div>
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-2 pt-2 border-t border-[var(--line)]">
          <button
            onClick={() => setActiveModal('none')}
            className="px-3 py-1 bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-[2px] text-[11px] font-mono cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={() => {
              setSelectedTicker(company.ticker);
              setActiveModal('none');
            }}
            className="px-3 py-1 bg-[var(--accent)] hover:brightness-105 text-[var(--bg-0)] font-semibold rounded-[2px] text-[11px] font-mono cursor-pointer"
          >
            Load in Terminal
          </button>
        </div>
      </div>
    </div>
  );
}
