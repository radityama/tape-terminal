'use client';

import React, { useState } from 'react';
import { useTerminalStore, BottomTab } from '../../store/useTerminalStore';
import { COMPANY_MAP } from '../../data/companies';
import { CaretUp, CaretDown, ShieldWarning, ChartBar, Trophy, CalendarBlank, ListBullets } from '@phosphor-icons/react';

export function BottomTabs() {
  const activeTab = useTerminalStore((s) => s.activeBottomTab);
  const setActiveTab = useTerminalStore((s) => s.setActiveBottomTab);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const placeOrder = useTerminalStore((s) => s.placeOrder);
  const cancelOrder = useTerminalStore((s) => s.cancelOrder);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);

  const [selectedRival, setSelectedRival] = useState<any | null>(null);

  if (!snapshot) return null;

  const positions = snapshot.positions;
  const orders = snapshot.openOrders;
  const blotter = snapshot.recentTrades;
  const risk = snapshot.riskMetrics;
  const upcomingEarnings = snapshot.upcomingEarnings;
  const rivals = snapshot.rivals;

  const handleClosePosition = (ticker: string, shares: number) => {
    const side = shares > 0 ? 'sell' : 'buy';
    placeOrder({
      ticker,
      side,
      type: 'market',
      quantity: Math.abs(shares),
      timeInForce: 'DAY',
    });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-1)] select-none text-[12px]" id="tutorial-positions-risk">
      {/* Tab Navigation Header */}
      <div className="h-[28px] border-b border-[var(--line)] px-2 flex items-center justify-between shrink-0 bg-[var(--bg-1)]">
        <div className="flex items-center space-x-1">
          {[
            { id: 'positions', label: `Positions (${positions.length})` },
            { id: 'orders', label: `Orders (${orders.length})` },
            { id: 'blotter', label: `Blotter (${blotter.length})` },
            { id: 'risk', label: 'Risk & Exposure' },
            { id: 'calendar', label: 'Earnings Calendar' },
            { id: 'leaderboard', label: 'Leaderboard' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as BottomTab)}
              className={`h-[27px] px-2.5 text-[11px] font-mono border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-b-[var(--accent)] text-[var(--accent)] font-semibold bg-[var(--bg-2)]'
                  : 'border-b-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Quick summary metric */}
        <div className="text-[11px] font-mono text-[var(--text-3)] pr-2">
          Buying Power: <span className="text-[var(--text-1)] font-medium">${risk.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Tab Content Panes */}
      <div className="flex-1 overflow-y-auto">
        {/* --- POSITIONS TAB --- */}
        {activeTab === 'positions' && (
          <div className="h-full flex flex-col">
            {positions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--text-3)] font-mono text-[11px]">
                <p>No open positions in account.</p>
                <p className="text-[10px] text-[var(--text-3)] mt-1">
                  Select a ticker from the watchlist or press / to place an order.
                </p>
              </div>
            ) : (
              <table className="w-full text-left font-mono text-[11px] divide-y divide-[var(--line)]">
                <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
                  <tr>
                    <th className="py-1.5 px-3">Symbol</th>
                    <th className="py-1.5 px-2 text-right">Shares</th>
                    <th className="py-1.5 px-2 text-right">Avg Entry</th>
                    <th className="py-1.5 px-2 text-right">Current</th>
                    <th className="py-1.5 px-2 text-right">Market Value</th>
                    <th className="py-1.5 px-2 text-right">Unrealized P&L</th>
                    <th className="py-1.5 px-2 text-right">Return</th>
                    <th className="py-1.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {positions.map((pos) => {
                    const isLong = pos.shares > 0;
                    const isProfitable = pos.unrealizedPnl >= 0;
                    return (
                      <tr 
                        key={pos.ticker} 
                        className="hover:bg-[var(--bg-2)] cursor-pointer transition-colors"
                        onClick={() => setSelectedTicker(pos.ticker)}
                      >
                        <td className="py-1.5 px-3 font-semibold text-[var(--text-1)]">
                          <span className="flex items-center space-x-1.5">
                            <span>{pos.ticker}</span>
                            <span className={`text-[9px] px-1 py-0.2 rounded-[2px] uppercase ${isLong ? 'bg-[var(--up)]/15 text-[var(--up)]' : 'bg-[var(--down)]/15 text-[var(--down)]'}`}>
                              {isLong ? 'LONG' : 'SHORT'}
                            </span>
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-1)]">
                          {Math.abs(pos.shares)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-2)]">
                          ${pos.averageEntryPrice.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-1)] font-medium">
                          ${pos.currentPrice.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-1)]">
                          ${pos.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-semibold ${isProfitable ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                          {isProfitable ? `+$${pos.unrealizedPnl.toFixed(2)}` : `-$${Math.abs(pos.unrealizedPnl).toFixed(2)}`}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-semibold ${isProfitable ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                          {isProfitable ? '+' : ''}{pos.unrealizedPnlPercent.toFixed(2)}%
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClosePosition(pos.ticker, pos.shares);
                            }}
                            className="px-2 py-0.5 rounded-[2px] bg-[var(--bg-0)] hover:bg-[var(--down)] hover:text-white border border-[var(--line)] text-[10px] text-[var(--text-2)] transition-colors cursor-pointer"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* --- ORDERS TAB --- */}
        {activeTab === 'orders' && (
          <div className="h-full flex flex-col">
            {orders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--text-3)] font-mono text-[11px]">
                <span>No active pending orders in the matching book.</span>
              </div>
            ) : (
              <table className="w-full text-left font-mono text-[11px] divide-y divide-[var(--line)]">
                <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
                  <tr>
                    <th className="py-1.5 px-3">Order ID</th>
                    <th className="py-1.5 px-2">Symbol</th>
                    <th className="py-1.5 px-2">Side</th>
                    <th className="py-1.5 px-2">Type</th>
                    <th className="py-1.5 px-2 text-right">Quantity</th>
                    <th className="py-1.5 px-2 text-right">Price Target</th>
                    <th className="py-1.5 px-2">TIF</th>
                    <th className="py-1.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {orders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[var(--bg-2)]">
                      <td className="py-1.5 px-3 text-[10px] text-[var(--text-3)]">{ord.id}</td>
                      <td className="py-1.5 px-2 font-semibold text-[var(--text-1)]">{ord.ticker}</td>
                      <td className="py-1.5 px-2">
                        <span className={`text-[10px] font-bold ${ord.side === 'buy' ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                          {ord.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-[var(--text-2)] uppercase text-[10px]">{ord.type.replace('_', ' ')}</td>
                      <td className="py-1.5 px-2 text-right text-[var(--text-1)]">{ord.quantity}</td>
                      <td className="py-1.5 px-2 text-right text-[var(--text-1)]">
                        {ord.limitPrice ? `$${ord.limitPrice.toFixed(2)}` : ord.stopPrice ? `$${ord.stopPrice.toFixed(2)}` : 'MKT'}
                      </td>
                      <td className="py-1.5 px-2 text-[10px] text-[var(--text-3)]">{ord.timeInForce}</td>
                      <td className="py-1.5 px-3 text-right">
                        <button
                          onClick={() => cancelOrder(ord.id)}
                          className="px-2 py-0.5 rounded-[2px] bg-[var(--bg-0)] hover:bg-[var(--down)] hover:text-white border border-[var(--line)] text-[10px] text-[var(--text-2)] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* --- BLOTTER TAB --- */}
        {activeTab === 'blotter' && (
          <div className="h-full flex flex-col">
            {blotter.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--text-3)] font-mono text-[11px]">
                <span>No trades executed yet. Complete a trade in the order ticket.</span>
              </div>
            ) : (
              <table className="w-full text-left font-mono text-[11px] divide-y divide-[var(--line)]">
                <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
                  <tr>
                    <th className="py-1.5 px-3">Symbol</th>
                    <th className="py-1.5 px-2">Side</th>
                    <th className="py-1.5 px-2 text-right">Shares</th>
                    <th className="py-1.5 px-2 text-right">Exec Price</th>
                    <th className="py-1.5 px-2 text-right">Total Value</th>
                    <th className="py-1.5 px-2 text-right">Commission</th>
                    <th className="py-1.5 px-2 text-right">Realized P&L</th>
                    <th className="py-1.5 px-3 text-right">Hold Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {blotter.map((trade) => {
                    const isProfit = (trade.realizedPnl ?? 0) >= 0;
                    return (
                      <tr key={trade.id} className="hover:bg-[var(--bg-2)]">
                        <td className="py-1.5 px-3 font-semibold text-[var(--text-1)]">{trade.ticker}</td>
                        <td className="py-1.5 px-2">
                          <span className={`text-[10px] font-bold ${trade.side === 'buy' ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                            {trade.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-1)]">{trade.shares}</td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-2)]">${trade.price.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-1)]">${trade.totalValue.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[var(--text-3)]">${trade.commission.toFixed(2)}</td>
                        <td className={`py-1.5 px-2 text-right font-semibold ${trade.realizedPnl !== undefined ? (isProfit ? 'text-[var(--up)]' : 'text-[var(--down)]') : 'text-[var(--text-3)]'}`}>
                          {trade.realizedPnl !== undefined ? (isProfit ? `+$${trade.realizedPnl.toFixed(2)}` : `-$${Math.abs(trade.realizedPnl).toFixed(2)}`) : 'OPEN'}
                        </td>
                        <td className="py-1.5 px-3 text-right text-[var(--text-3)]">
                          {trade.holdingTimeMinutes ? `${trade.holdingTimeMinutes}m` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* --- RISK & EXPOSURE TAB --- */}
        {activeTab === 'risk' && (
          <div className="p-3 space-y-3 font-mono text-[11px]">
            {/* Cushion Warning Banner if in danger */}
            {risk.isMarginWarning && (
              <div className="bg-[var(--down)]/15 border border-[var(--down)] text-[var(--down)] p-2 rounded-[2px] flex items-center space-x-2">
                <ShieldWarning size={16} weight="bold" />
                <span>Margin Cushion Warning: Maintenance cushion is {risk.marginCushionPercent.toFixed(1)}%. Maintain excess capital to prevent forced liquidation.</span>
              </div>
            )}

            {/* Top Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
                <div className="text-[10px] uppercase text-[var(--text-3)]">Cash Balance</div>
                <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">${risk.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
                <div className="text-[10px] uppercase text-[var(--text-3)]">Gross Leverage</div>
                <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">{risk.grossLeverage.toFixed(2)}x</div>
              </div>
              <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
                <div className="text-[10px] uppercase text-[var(--text-3)]">Portfolio Beta vs TAPE50</div>
                <div className="text-[14px] font-bold text-[var(--text-1)] mt-0.5">{risk.portfolioBeta.toFixed(2)}</div>
              </div>
              <div className="bg-[var(--bg-0)] p-2 border border-[var(--line)] rounded-[2px]">
                <div className="text-[10px] uppercase text-[var(--text-3)]">1-Day 95% Parametric VaR</div>
                <div className="text-[14px] font-bold text-[var(--down)] mt-0.5">${risk.oneDayParametricVaR.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>

            {/* Sector Exposure Breakdown */}
            <div className="bg-[var(--bg-0)] p-2.5 border border-[var(--line)] rounded-[2px] space-y-2">
              <div className="text-[10px] uppercase text-[var(--text-3)] border-b border-[var(--line)] pb-1">
                Portfolio Sector Allocation
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {risk.sectorExposures.map((sec) => (
                  <div key={sec.sector} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[var(--text-2)]">{sec.sector}</span>
                      <span className="text-[var(--text-1)]">${sec.dollarValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({sec.percentageOfEquity}%)</span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-2)] rounded-[1px] overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${Math.min(100, sec.percentageOfEquity)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* --- EARNINGS CALENDAR TAB --- */}
        {activeTab === 'calendar' && (
          <div className="p-2 space-y-2 font-mono text-[11px]">
            <table className="w-full text-left divide-y divide-[var(--line)]">
              <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
                <tr>
                  <th className="py-1.5 px-3">Date</th>
                  <th className="py-1.5 px-2">Symbol</th>
                  <th className="py-1.5 px-2">Company Name</th>
                  <th className="py-1.5 px-2">Quarter</th>
                  <th className="py-1.5 px-2 text-right">Consensus EPS</th>
                  <th className="py-1.5 px-2 text-right">Consensus Rev</th>
                  <th className="py-1.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {upcomingEarnings.map((earn) => (
                  <tr key={earn.id} className="hover:bg-[var(--bg-2)] cursor-pointer">
                    <td className="py-1.5 px-3 text-[var(--text-3)]">Sim Day {earn.simDay}</td>
                    <td className="py-1.5 px-2 font-bold text-[var(--text-1)]">{earn.ticker}</td>
                    <td className="py-1.5 px-2 text-[var(--text-2)] font-sans">{COMPANY_MAP.get(earn.ticker || '')?.name}</td>
                    <td className="py-1.5 px-2 text-[var(--accent)]">{earn.earningsDetails?.quarter}</td>
                    <td className="py-1.5 px-2 text-right text-[var(--text-1)]">${earn.earningsDetails?.consensusEps.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-[var(--text-1)]">${earn.earningsDetails?.consensusRevenue.toFixed(2)}B</td>
                    <td className="py-1.5 px-3 text-right">
                      <button
                        onClick={() => earn.ticker && setSelectedTicker(earn.ticker)}
                        className="px-2 py-0.5 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-1)] cursor-pointer"
                      >
                        Chart
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* --- LEADERBOARD TAB --- */}
        {activeTab === 'leaderboard' && (
          <div className="p-2 space-y-3 font-mono text-[11px]">
            <table className="w-full text-left divide-y divide-[var(--line)]">
              <thead className="bg-[var(--bg-0)] text-[10px] uppercase text-[var(--text-3)] sticky top-0">
                <tr>
                  <th className="py-1.5 px-3">Rank</th>
                  <th className="py-1.5 px-2">Trader / Fund</th>
                  <th className="py-1.5 px-2">Style</th>
                  <th className="py-1.5 px-2 text-right">Current Equity</th>
                  <th className="py-1.5 px-2 text-right">Total Return</th>
                  <th className="py-1.5 px-2 text-right">Sharpe Ratio</th>
                  <th className="py-1.5 px-3 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {/* Player Row */}
                <tr className="bg-[var(--accent)]/10 border-l-2 border-l-[var(--accent)] font-semibold">
                  <td className="py-1.5 px-3 text-[var(--accent)]">YOU</td>
                  <td className="py-1.5 px-2 text-[var(--text-1)]">You (Career Account)</td>
                  <td className="py-1.5 px-2 text-[var(--accent)]">Discretionary Trader</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-1)]">${risk.netLiquidationValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className={`py-1.5 px-2 text-right ${risk.netLiquidationValue >= 100000 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                    {risk.netLiquidationValue >= 100000 ? '+' : ''}{(((risk.netLiquidationValue - 100000) / 100000) * 100).toFixed(2)}%
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-1)]">1.50</td>
                  <td className="py-1.5 px-3 text-right text-[var(--text-3)]">-</td>
                </tr>

                {/* AI Rivals */}
                {rivals.map((rival, idx) => {
                  const isProfit = rival.totalReturnPct >= 0;
                  return (
                    <tr key={rival.id} className="hover:bg-[var(--bg-2)]">
                      <td className="py-1.5 px-3 text-[var(--text-3)]">#{idx + 2}</td>
                      <td className="py-1.5 px-2 text-[var(--text-1)] font-medium">
                        <div>{rival.name}</div>
                        <div className="text-[9px] text-[var(--text-3)] font-sans">{rival.firm}</div>
                      </td>
                      <td className="py-1.5 px-2 text-[var(--text-2)] text-[10px]">{rival.style}</td>
                      <td className="py-1.5 px-2 text-right text-[var(--text-1)]">${rival.currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`py-1.5 px-2 text-right font-medium ${isProfit ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                        {isProfit ? '+' : ''}{rival.totalReturnPct.toFixed(2)}%
                      </td>
                      <td className="py-1.5 px-2 text-right text-[var(--text-2)]">{rival.sharpeRatio.toFixed(2)}</td>
                      <td className="py-1.5 px-3 text-right">
                        <button
                          onClick={() => setSelectedRival(rival)}
                          className="px-2 py-0.5 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-1)] cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Rival Inspector Modal */}
            {selectedRival && (
              <div className="fixed inset-0 bg-[var(--bg-0)]/80 flex items-center justify-center z-50 p-4 font-sans">
                <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-md w-full p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-[var(--line)] pb-2">
                    <div>
                      <div className="text-[14px] font-bold text-[var(--text-1)]">{selectedRival.name}</div>
                      <div className="text-[11px] text-[var(--text-3)] font-mono">{selectedRival.firm} - {selectedRival.style}</div>
                    </div>
                    <button
                      onClick={() => setSelectedRival(null)}
                      className="px-2 py-1 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
                    >
                      Close
                    </button>
                  </div>

                  <p className="text-[12px] text-[var(--text-2)] leading-relaxed">
                    {selectedRival.bio}
                  </p>

                  <div className="bg-[var(--bg-0)] p-2 rounded-[2px] font-mono text-[11px] space-y-1">
                    <div className="text-[10px] uppercase text-[var(--text-3)] mb-1">Delayed Holdings Sample</div>
                    {selectedRival.currentHoldings.length === 0 ? (
                      <div className="text-[var(--text-3)]">In 100% Cash Reserves</div>
                    ) : (
                      selectedRival.currentHoldings.map((h: any) => (
                        <div key={h.ticker} className="flex justify-between">
                          <span className="text-[var(--text-1)]">{h.ticker}</span>
                          <span className="text-[var(--text-2)]">{h.shares} shares ({h.weightPct}%)</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
