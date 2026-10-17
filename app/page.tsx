'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTerminalStore } from '../src/store/useTerminalStore';
import { COMPANIES } from '../src/data/companies';
import { SCENARIOS, Scenario } from '../src/data/scenarios';
import { saveManager, MergedSlot } from '../src/saves/manager';
import { useAuthStore } from '../src/store/useAuthStore';
import { AuthDialogs } from '../src/features/auth/AuthDialogs';
import { Play, CaretRight, Sliders, Gear, Sparkle, CaretUp, CaretDown, BookOpen } from '@phosphor-icons/react';

export default function TitlePage() {
  const router = useRouter();
  const initEngine = useTerminalStore((s) => s.initEngine);
  const startScenario = useTerminalStore((s) => s.startScenario);
  const restartTutorial = useTerminalStore((s) => s.restartTutorial);
  const authConfigured = useAuthStore((s) => s.configured);
  const authReady = useAuthStore((s) => s.ready);
  const authSignedIn = useAuthStore((s) => s.signedIn);
  const authUser = useAuthStore((s) => s.user);
  const openAuthDialog = useAuthStore((s) => s.openDialog);

  const [slots, setSlots] = useState<MergedSlot[]>([]);
  const [historySlots, setHistorySlots] = useState<number[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [seedInput, setSeedInput] = useState('TAPE_1337');
  const [difficultySelect, setDifficultySelect] = useState<'learner' | 'standard' | 'hardcore'>('standard');

  // Live preview ladder simulated locally for title screen right panel
  const [ladderPrices, setLadderPrices] = useState(
    COMPANIES.slice(0, 14).map((c) => ({
      ticker: c.ticker,
      name: c.name,
      price: c.initialPrice,
      chg: 0,
    }))
  );

  useEffect(() => {
    // Check for ?autostart=1
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        initEngine('TAPE_1337', 'career', 100000);
        router.push('/terminal');
        return;
      }
    }

    // Muted background tick loop for title screen price ladder
    const interval = setInterval(() => {
      setLadderPrices((prev) =>
        prev.map((item) => {
          const delta = (Math.random() - 0.49) * 0.15;
          const newPrice = Math.max(1, Math.round((item.price + delta) * 100) / 100);
          return {
            ...item,
            price: newPrice,
            chg: Math.round(((newPrice - item.price) / item.price) * 1000) / 10,
          };
        })
      );
    }, 1500);

    return () => clearInterval(interval);
  }, [initEngine, router]);

  // Resolve the account before showing cloud slots, so the list never jumps from local to cloud.
  useEffect(() => {
    useAuthStore.getState().init();
  }, []);

  useEffect(() => {
    if (authConfigured && !authReady) return;
    void saveManager.listAllSlots().then(async (list) => {
      setSlots(list);
      const withHistory = await Promise.all(
        list.map((slot) => saveManager.hasHistory(slot.slot).then((has) => (has ? slot.slot : null)))
      );
      setHistorySlots(withHistory.filter((slot): slot is number => slot !== null));
    });
  }, [authConfigured, authReady, authSignedIn]);

  const handleStartCareer = () => {
    const slot = saveManager.getActiveSlot();
    const occupied = slots.some((s) => s.slot === slot);
    if (occupied && !window.confirm('Starting a new career replaces the save in this slot. Continue?')) return;
    initEngine(seedInput || 'TAPE_1337', 'career', 100000);
    // Explicit choice: replace the slot even though its seq is higher than a fresh career.
    void saveManager.save(slot, { force: true });
    // Trigger tutorial on first career start
    useTerminalStore.getState().setDifficulty(difficultySelect);
    useTerminalStore.getState().restartTutorial();
    router.push('/terminal');
  };

  const handleRestoreAutosave = async (slot: number) => {
    if (!window.confirm('Restore the previous autosave in this slot?')) return;
    const ok = await saveManager.restoreHistory(slot);
    if (ok) router.push('/terminal');
  };

  const handleContinue = async (save: MergedSlot) => {
    const outcome = await saveManager.load(save.slot);
    if (outcome.ok) router.push('/terminal');
  };

  const handleLaunchScenario = (sc: Scenario) => {
    startScenario(sc);
    setShowScenarioModal(false);
    router.push('/terminal');
  };

  return (
    <main className="relative min-h-[100dvh] w-full bg-[var(--bg-0)] text-[var(--text-1)] flex items-center justify-center p-6 select-none font-sans">
      {authConfigured && (
        <div className="absolute top-6 right-6 font-mono text-[11px]">
          {!authReady ? (
            <span className="text-[var(--text-3)]">Checking account...</span>
          ) : authSignedIn ? (
            <button
              onClick={() => openAuthDialog('account')}
              className="text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
            >
              {authUser?.email ?? 'Account'}
            </button>
          ) : (
            <button
              onClick={() => openAuthDialog('signin')}
              className="text-[var(--accent)] hover:underline cursor-pointer"
            >
              Sign in
            </button>
          )}
        </div>
      )}
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left: Minimal Product & Career Launcher (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-[var(--accent)] bg-[var(--bg-2)] border border-[var(--line)] px-2 py-0.5 rounded-[2px]">
                STOCKS EDITION
              </span>
              <span className="text-[11px] font-mono text-[var(--text-3)]">
                CLIENT-SIDE SIMULATION
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-mono text-[var(--text-1)]">
              TAPE
            </h1>

            <p className="text-[14px] text-[var(--text-2)] leading-relaxed max-w-lg font-sans">
              A professional trading terminal and market simulator. Trade 48 listed equities across 8 sectors with realistic spreads, depth ladder slippage, earnings shocks, and macroeconomic rate decisions.
            </p>
          </div>

          {/* New Game Setup Controls */}
          <div className="bg-[var(--bg-1)] p-4 border border-[var(--line)] rounded-[2px] space-y-3 font-mono text-[12px] max-w-md">
            <div>
              <label className="text-[10px] uppercase text-[var(--text-3)] block mb-1">
                Universe Seed
              </label>
              <input
                type="text"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="TAPE_1337"
                className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2.5 py-1 text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase text-[var(--text-3)] block mb-1">
                Difficulty Preset
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['learner', 'standard', 'hardcore'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficultySelect(d)}
                    className={`py-1 text-center capitalize rounded-[2px] border text-[11px] cursor-pointer transition-colors ${
                      difficultySelect === d
                        ? 'bg-[var(--accent)] text-black font-semibold border-[var(--accent)]'
                        : 'bg-[var(--bg-0)] text-[var(--text-3)] border-[var(--line)] hover:text-[var(--text-1)]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Launch Buttons */}
            <div className="pt-2 flex flex-col space-y-2">
              <button
                onClick={handleStartCareer}
                className="w-full py-2.5 bg-[var(--accent)] hover:brightness-105 active:translate-y-[1px] text-black font-bold text-[13px] rounded-[2px] flex items-center justify-center space-x-2 cursor-pointer transition-all"
              >
                <span>Start New Career ($100k)</span>
                <CaretRight size={14} weight="bold" />
              </button>

              <button
                onClick={() => setShowScenarioModal(true)}
                className="w-full py-2 bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] font-semibold text-[12px] rounded-[2px] flex items-center justify-center space-x-2 border border-[var(--line)] cursor-pointer"
              >
                <span>Historical Scenarios (Sandbox)</span>
              </button>
            </div>
          </div>

          {/* Continue Save Slots if available */}
          {authConfigured && !authReady ? (
            <div className="max-w-md space-y-2 font-mono text-[11px]" aria-busy="true">
              <div className="text-[10px] uppercase text-[var(--text-3)]">
                Existing Save Slots
              </div>
              <div className="w-full p-2 bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px]">
                <div className="h-3 w-32 bg-[var(--line)] rounded-[2px] animate-pulse" />
                <div className="h-2 w-48 bg-[var(--line)] rounded-[2px] mt-2 animate-pulse" />
                <div className="text-[10px] text-[var(--text-3)] mt-2">Checking account...</div>
              </div>
            </div>
          ) : slots.length > 0 ? (
            <div className="max-w-md space-y-2 font-mono text-[11px]">
              <div className="text-[10px] uppercase text-[var(--text-3)]">
                Existing Save Slots
              </div>
              <div className="space-y-1">
                {slots.slice(0, 3).map((slot) => (
                  <button
                    key={slot.slot}
                    onClick={() => handleContinue(slot)}
                    className="w-full p-2 bg-[var(--bg-1)] hover:bg-[var(--bg-2)] border border-[var(--line)] rounded-[2px] flex items-center justify-between text-left cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-[var(--text-1)]">
                        {slot.meta.name}
                        <span className="text-[10px] text-[var(--text-3)] pl-2">
                          {slot.origin === 'both' ? 'Both' : slot.origin === 'cloud' ? 'Cloud' : 'This device'}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-3)]">
                        Day {slot.meta.simDay} | Net Equity ${slot.meta.equity.toLocaleString()}
                      </div>
                    </div>
                    <span className="text-[var(--accent)] text-[10px]">Resume &rarr;</span>
                    {historySlots.includes(slot.slot) && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRestoreAutosave(slot.slot);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            void handleRestoreAutosave(slot.slot);
                          }
                        }}
                        className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] pl-2 cursor-pointer underline"
                      >
                        Restore previous autosave
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Live Simulated Price Ladder (5 cols) */}
        <div className="lg:col-span-5 bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px] p-3 shadow-2xl font-mono text-[11px]">
          <div className="flex justify-between items-center border-b border-[var(--line)] pb-2 mb-2">
            <span className="text-[10px] uppercase text-[var(--text-3)] tracking-wider">
              Market Depth Tape (Live Tick)
            </span>
            <span className="text-[10px] text-[var(--up)] flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--up)]" />
              <span>SYNCHRONIZED</span>
            </span>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {ladderPrices.map((row) => (
              <div key={row.ticker} className="py-1.5 flex items-center justify-between">
                <div>
                  <span className="font-bold text-[var(--text-1)]">{row.ticker}</span>
                  <span className="text-[10px] text-[var(--text-3)] pl-2 truncate">{row.name}</span>
                </div>
                <div className="flex items-center space-x-3 text-right">
                  <span className="font-semibold text-[var(--text-1)]">${row.price.toFixed(2)}</span>
                  <span className={`text-[10px] flex items-center ${row.chg >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                    {row.chg >= 0 ? <CaretUp weight="bold" size={9} /> : <CaretDown weight="bold" size={9} />}
                    {row.chg >= 0 ? '+' : ''}{row.chg.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t border-[var(--line)] text-[10px] text-[var(--text-3)] text-center">
            Bloomberg-lineage density. 48 equities across 8 sectors.
          </div>
        </div>
      </div>

      {/* Scenarios Modal */}
      {showScenarioModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-sans select-none">
          <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-xl w-full p-4 space-y-3 font-mono text-[11px] shadow-2xl">
            <div className="flex justify-between items-center border-b border-[var(--line)] pb-2">
              <span className="font-bold text-[13px] text-[var(--text-1)]">
                Hand-Authored Historical Scenarios
              </span>
              <button
                onClick={() => setShowScenarioModal(false)}
                className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {SCENARIOS.map((sc) => (
                <div
                  key={sc.id}
                  onClick={() => handleLaunchScenario(sc)}
                  className="p-3 bg-[var(--bg-0)] hover:bg-[var(--bg-2)] border border-[var(--line)] rounded-[2px] cursor-pointer transition-colors space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[12px] text-[var(--accent)]">{sc.title}</span>
                    <span className="text-[10px] text-[var(--text-3)] uppercase">{sc.durationDays} Days | Initial {sc.initialRegime}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-2)] font-sans leading-relaxed">
                    {sc.briefing}
                  </p>
                  <div className="text-[10px] text-[var(--text-3)] flex items-center space-x-2 pt-1 border-t border-[var(--line)]">
                    <span>Key Tickers: {sc.featuredTickers.join(', ')}</span>
                    <span>|</span>
                    <span>Target: +${sc.targetProfit.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <AuthDialogs />
    </main>
  );
}
