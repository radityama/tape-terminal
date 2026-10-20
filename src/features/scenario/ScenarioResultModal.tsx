'use client';

import React from 'react';
import { Dialog } from '../dialog/Dialog';
import { Money } from '../../lib/money';
import { SCENARIOS } from '../../data/scenarios';
import { useTerminalStore } from '../../store/useTerminalStore';

function useScenarioRun() {
  const engine = useTerminalStore((s) => s.engine);
  const run = engine?.getScenarioRun();
  return { run, scenario: run ? SCENARIOS.find((s) => s.id === run.id) ?? null : null };
}

export function ScenarioResultModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const { run, scenario } = useScenarioRun();

  if (activeModal !== 'scenario-result' || !run?.result || !scenario) return null;
  const result = run.result;

  return (
    <Dialog title="Scenario result" onClose={() => setActiveModal('none')} width="max-w-md">
      <div className="overflow-y-auto p-4 space-y-4 font-mono text-[11px]">
        <div>
          <div className="text-[var(--text-3)] uppercase tracking-wide text-[10px]">Scenario</div>
          <div className="text-[var(--text-1)] text-[13px] font-semibold">{scenario.title}</div>
        </div>

        <div className="flex items-center gap-4 border border-[var(--line)] bg-[var(--bg-0)] p-3 rounded-[2px]">
          <div className={`text-3xl font-bold ${result.grade === 'A' ? 'text-[var(--up)]' : result.grade === 'D' ? 'text-[var(--down)]' : 'text-[var(--text-1)]'}`}>
            {result.grade}
          </div>
          <div className="space-y-0.5">
            <div className="text-[var(--text-1)]">
              {result.success ? 'Target met' : 'Target missed'}
            </div>
            <div className="text-[var(--text-3)]">
              Score {result.score.toLocaleString()} / 10,000
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Final equity" value={Money.from(result.finalEquity).format()} />
          <Metric label="Net P&L" value={Money.from(result.netGain).format(true)} tone={result.netGain} />
          <Metric label="Profit target" value={Money.from(scenario.targetProfit).format()} />
          <Metric label="A benchmark" value={`${scenario.scoreBenchmark.toLocaleString()} pts`} />
          <Metric label="Settled days" value={`${run.settledDays} / ${scenario.durationDays}`} />
          <Metric label="Completed" value={`Day ${result.completedDay}`} />
        </div>

        <p className="text-[var(--text-3)] leading-relaxed">
          Graded on net equity after fees and financing. Winning requires the profit target; the grade uses the
          scenario benchmark. Trading is frozen for this scenario.
        </p>

        <button
          type="button"
          data-autofocus
          onClick={() => setActiveModal('none')}
          className="w-full border border-[var(--line-strong)] rounded-[2px] px-3 py-2 text-[var(--text-1)] hover:bg-[var(--bg-2)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          Return to terminal
        </button>
      </div>
    </Dialog>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const color = tone === undefined ? 'text-[var(--text-1)]' : tone > 0 ? 'text-[var(--up)]' : tone < 0 ? 'text-[var(--down)]' : 'text-[var(--text-1)]';
  return (
    <div className="border border-[var(--line)] rounded-[2px] p-2">
      <div className="text-[var(--text-3)] text-[10px] uppercase tracking-wide">{label}</div>
      <div className={`mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

export function ScenarioProgress() {
  const simDay = useTerminalStore((s) => s.snapshot?.simDay ?? 1);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const { run, scenario } = useScenarioRun();

  if (!run || !scenario) return null;
  const result = run.result;
  const currentDay = Math.min(simDay - run.startDay + 1, scenario.durationDays);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-1)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-3)] shrink-0">
      <span className="text-[var(--accent)] uppercase tracking-wide">Scenario</span>
      <span className="text-[var(--text-2)] truncate min-w-0">{scenario.title}</span>
      {result ? (
        <>
          <span className="ml-auto whitespace-nowrap">Grade {result.grade} · {result.score.toLocaleString()}</span>
          <button
            type="button"
            onClick={() => setActiveModal('scenario-result')}
            className="border border-[var(--line)] rounded-[2px] px-2 py-0.5 text-[var(--text-1)] hover:bg-[var(--bg-2)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            View result
          </button>
        </>
      ) : (
        <span className="ml-auto whitespace-nowrap">Day {currentDay}/{scenario.durationDays}</span>
      )}
    </div>
  );
}
