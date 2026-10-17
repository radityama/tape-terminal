'use client';

import React, { useEffect, useRef } from 'react';
import { useTerminalStore } from '../../../src/store/useTerminalStore';
import { WorkspaceLayout } from '../../../src/features/workspace/WorkspaceLayout';
import { CommandBar } from '../../../src/features/command-bar/CommandBar';
import { ScreenerModal } from '../../../src/features/screener/ScreenerModal';
import { CompanyModal } from '../../../src/features/company/CompanyModal';
import { CareerModal } from '../../../src/features/career/CareerModal';
import { EndOfDayModal } from '../../../src/features/eod-report/EndOfDayModal';
import { SettingsModal } from '../../../src/features/settings/SettingsModal';
import { SpotlightTutorial } from '../../../src/features/tutorial/SpotlightTutorial';
import { ToastContainer } from '../../../src/features/toasts/ToastContainer';

export default function TerminalPage() {
  const engine = useTerminalStore((s) => s.engine);
  const initEngine = useTerminalStore((s) => s.initEngine);
  const setSnapshot = useTerminalStore((s) => s.setSnapshot);
  const lastTickTime = useRef<number>(0);

  // Initialize engine if not already running
  useEffect(() => {
    if (!engine) {
      initEngine('TAPE_1337', 'career', 100000);
    }
  }, [engine, initEngine]);

  // Simulation tick loop (runs engine ticks and batches snapshots to main thread:
  // at most 4 times per second at 1x, up to 10 per second at 20x)
  useEffect(() => {
    let lastSnapshotTime = 0;
    if (lastTickTime.current === 0) {
      lastTickTime.current = Date.now();
    }

    const interval = setInterval(() => {
      const activeEngine = useTerminalStore.getState().engine;
      if (!activeEngine) return;

      const now = Date.now();
      const deltaSec = (now - lastTickTime.current) / 1000;
      lastTickTime.current = now;

      // Tick the market simulation engine
      activeEngine.tick(Math.min(0.5, deltaSec));

      const speed = activeEngine.getSpeed();
      if (speed === 0) return;

      // Staggered, speed-aware snapshot cadence to main thread:
      // 1x: at most 4 times per second (>= 250ms)
      // 5x: at most ~6.6 times per second (>= 150ms)
      // 20x: up to 10 times per second (>= 100ms)
      const minInterval = speed >= 20 ? 100 : speed >= 5 ? 150 : 250;

      if (now - lastSnapshotTime >= minInterval) {
        lastSnapshotTime = now;
        setSnapshot(activeEngine.getSnapshot());
      }
    }, 50);

    return () => clearInterval(interval);
  }, [setSnapshot]);

  // Global hotkeys (Space to toggle pause)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const activeEngine = useTerminalStore.getState().engine;
        if (activeEngine) {
          const curSpeed = activeEngine.getSpeed();
          useTerminalStore.getState().setSimSpeed(curSpeed === 0 ? 1 : 0);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  return (
    <div className="min-h-[100dvh] w-full bg-[var(--bg-0)] text-[var(--text-1)] overflow-hidden font-sans">
      {/* Dockable Workspace */}
      <WorkspaceLayout />

      {/* Floating Systemic Layers */}
      <CommandBar />
      <ScreenerModal />
      <CompanyModal />
      <CareerModal />
      <EndOfDayModal />
      <SettingsModal />
      <SpotlightTutorial />
      <ToastContainer />
    </div>
  );
}
