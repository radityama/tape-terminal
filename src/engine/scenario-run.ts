import type { Scenario } from '../data/scenarios';
import { Money } from '../lib/money';

export interface ScenarioResult {
  completedDay: number;
  finalEquity: number;
  netGain: number;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  success: boolean;
}

export interface ScenarioRun {
  id: string;
  startDay: number;
  startingEquity: number;
  settledDays: number;
  result?: ScenarioResult;
}

export function scoreScenario(scenario: Scenario, run: ScenarioRun, finalEquity: number, completedDay: number): ScenarioResult {
  const netGain = Money.from(finalEquity).sub(run.startingEquity).toNumber();
  const score = Math.round(Math.min(10_000, Math.max(0, 10_000 * netGain / scenario.targetProfit)));
  const benchmark = scenario.scoreBenchmark;
  return {
    completedDay,
    finalEquity,
    netGain,
    score,
    grade: score >= benchmark ? 'A' : score >= benchmark * 0.75 ? 'B' : score >= benchmark * 0.5 ? 'C' : 'D',
    success: netGain >= scenario.targetProfit,
  };
}
