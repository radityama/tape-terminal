'use client';

import React, { useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TopBar } from '../topbar/TopBar';
import { TapeTicker } from '../topbar/TapeTicker';
import { SyncIndicator } from '../auth/SyncIndicator';
import { WatchlistPanel } from '../watchlist/WatchlistPanel';
import { TradingViewChart } from '../chart/TradingViewChart';
import { OrderTicket } from '../ticket/OrderTicket';
import { Level2Depth } from '../depth/Level2Depth';
import { NewsFeed } from '../news/NewsFeed';
import { BottomTabs } from '../bottom-dock/BottomTabs';
import { useTerminalStore } from '../../store/useTerminalStore';
import { ChartLine, TrendUp, NewspaperClipping, Sliders } from '@phosphor-icons/react';

export function WorkspaceLayout() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const difficulty = useTerminalStore((s) => s.difficulty);

  // Mobile active tab (below lg / 1024px)
  const [mobileTab, setMobileTab] = useState<'chart' | 'ticket' | 'watchlist' | 'news' | 'positions'>('chart');

  if (!snapshot) return null;

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-[var(--bg-0)]">
      {/* 1. Ticker Tape */}
      <TapeTicker />

      {/* 2. Top Bar */}
      <TopBar />

      {/* 3. Main Desktop Workspace (>= 1024px) */}
      <div className="flex-1 hidden lg:flex flex-col overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="tape-main-horizontal-v1">
          {/* Left Column: Watchlist (20% default) */}
          <Panel defaultSize={20} minSize={14} maxSize={30} id="panel-watchlist">
            <WatchlistPanel />
          </Panel>

          <PanelResizeHandle className="w-[3px] bg-[var(--line)] hover:bg-[var(--accent)] transition-colors cursor-col-resize" />

          {/* Center Column: Chart (Top 62%) + Bottom Tabs (Bottom 38%) */}
          <Panel defaultSize={56} minSize={40} id="panel-center">
            <PanelGroup direction="vertical" autoSaveId="tape-center-vertical-v1">
              <Panel defaultSize={62} minSize={40} id="panel-chart">
                <TradingViewChart />
              </Panel>

              <PanelResizeHandle className="h-[3px] bg-[var(--line)] hover:bg-[var(--accent)] transition-colors cursor-row-resize" />

              <Panel defaultSize={38} minSize={25} id="panel-bottom-dock">
                <BottomTabs />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-[3px] bg-[var(--line)] hover:bg-[var(--accent)] transition-colors cursor-col-resize" />

          {/* Right Column: Order Ticket + Level 2 (Top 60%) + News Feed (Bottom 40%) */}
          <Panel defaultSize={24} minSize={18} maxSize={35} id="panel-right">
            <PanelGroup direction="vertical" autoSaveId="tape-right-vertical-v1">
              <Panel defaultSize={65} minSize={45} id="panel-ticket-depth">
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-hidden">
                    <OrderTicket />
                  </div>
                  <div className="h-44 border-t border-[var(--line)]">
                    <Level2Depth />
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="h-[3px] bg-[var(--line)] hover:bg-[var(--accent)] transition-colors cursor-row-resize" />

              <Panel defaultSize={35} minSize={20} id="panel-news">
                <NewsFeed />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Mobile / Tablet Workspace (< 1024px) */}
      <div className="flex-1 flex flex-col lg:hidden overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'chart' && <TradingViewChart />}
          {mobileTab === 'ticket' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <OrderTicket />
              </div>
              <div className="h-44 border-t border-[var(--line)]">
                <Level2Depth />
              </div>
            </div>
          )}
          {mobileTab === 'watchlist' && <WatchlistPanel />}
          {mobileTab === 'news' && <NewsFeed />}
          {mobileTab === 'positions' && <BottomTabs />}
        </div>

        {/* Mobile Bottom Tab Bar */}
        <div className="h-12 bg-[var(--bg-1)] border-t border-[var(--line)] grid grid-cols-5 text-[10px] font-mono select-none">
          <button
            onClick={() => setMobileTab('chart')}
            className={`flex flex-col items-center justify-center space-y-0.5 ${
              mobileTab === 'chart' ? 'text-[var(--accent)] bg-[var(--bg-2)]' : 'text-[var(--text-3)]'
            }`}
          >
            <ChartLine size={16} weight="bold" />
            <span>Chart</span>
          </button>
          <button
            onClick={() => setMobileTab('ticket')}
            className={`flex flex-col items-center justify-center space-y-0.5 ${
              mobileTab === 'ticket' ? 'text-[var(--accent)] bg-[var(--bg-2)]' : 'text-[var(--text-3)]'
            }`}
          >
            <TrendUp size={16} weight="bold" />
            <span>Trade</span>
          </button>
          <button
            onClick={() => setMobileTab('watchlist')}
            className={`flex flex-col items-center justify-center space-y-0.5 ${
              mobileTab === 'watchlist' ? 'text-[var(--accent)] bg-[var(--bg-2)]' : 'text-[var(--text-3)]'
            }`}
          >
            <Sliders size={16} weight="bold" />
            <span>Watch</span>
          </button>
          <button
            onClick={() => setMobileTab('positions')}
            className={`flex flex-col items-center justify-center space-y-0.5 ${
              mobileTab === 'positions' ? 'text-[var(--accent)] bg-[var(--bg-2)]' : 'text-[var(--text-3)]'
            }`}
          >
            <span className="font-bold text-[12px]">POS</span>
            <span>Positions</span>
          </button>
          <button
            onClick={() => setMobileTab('news')}
            className={`flex flex-col items-center justify-center space-y-0.5 ${
              mobileTab === 'news' ? 'text-[var(--accent)] bg-[var(--bg-2)]' : 'text-[var(--text-3)]'
            }`}
          >
            <NewspaperClipping size={16} weight="bold" />
            <span>Wire</span>
          </button>
        </div>
      </div>

      {/* 4. Terminal Status Bar at Bottom */}
      <footer className="h-[22px] bg-[var(--bg-1)] border-t border-[var(--line)] px-2 sm:px-3 flex items-center justify-between text-[9px] sm:text-[10px] font-mono text-[var(--text-3)] select-none shrink-0 z-20">
        <div className="flex items-center space-x-2 sm:space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--up)]" />
            <span className="text-[var(--text-2)] uppercase">Engine Active</span>
          </div>

          <span className="text-[var(--line-strong)]">|</span>

          <span>Regime: <strong className="text-[var(--accent)] uppercase">{snapshot.regime}</strong></span>

          {difficulty === 'learner' && (
            <>
              <span className="hidden sm:inline text-[var(--line-strong)]">|</span>
              <span className="hidden sm:inline text-[var(--text-2)]">Learner hint: Watch beta exposure</span>
            </>
          )}
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <span className="hidden md:inline">Shortcut: Press / for command bar</span>
          <span className="hidden md:inline text-[var(--line-strong)]">|</span>
          <span className="hidden sm:flex items-center">
            <SyncIndicator />
          </span>
          <span className="hidden sm:inline text-[var(--line-strong)]">|</span>
          <span>TAPE Equities</span>
        </div>
      </footer>
    </div>
  );
}
