import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from './market.ts';
import { SCENARIOS } from '../data/scenarios.ts';
import { scoreScenario, type ScenarioRun } from './scenario-run.ts';

function run(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return { id: 'quiet_grind', startDay: 1, startingEquity: 100_000, settledDays: 0, ...overrides };
}

test('score is profit-only and grades against the scenario benchmark', () => {
  const scenario = SCENARIOS.find((entry) => entry.id === 'quiet_grind')!;
  assert.equal(scoreScenario(scenario, run(), 108_000, 5).score, 8_000);
  assert.equal(scoreScenario(scenario, run(), 108_000, 5).grade, 'A');
  assert.equal(scoreScenario(scenario, run(), 108_000, 5).success, false);
  assert.equal(scoreScenario(scenario, run(), 107_000, 5).grade, 'B');
  assert.equal(scoreScenario(scenario, run(), 105_000, 5).grade, 'C');
  assert.equal(scoreScenario(scenario, run(), 103_000, 5).grade, 'D');
  assert.equal(scoreScenario(scenario, run(), 110_000, 5).success, true);
  assert.equal(scoreScenario(scenario, run(), 110_000, 5).grade, 'A');
  assert.equal(scoreScenario(scenario, run(), 200_000, 5).score, 10_000);
  assert.equal(scoreScenario(scenario, run(), 95_000, 5).score, 0);
  assert.equal(scoreScenario(scenario, run(), 95_000, 5).grade, 'D');
});

test('all four scenarios start with their own seed, regime and baseline', () => {
  for (const scenario of SCENARIOS) {
    const engine = new MarketSimulationEngine(scenario.seed, 100_000);
    engine.startScenario(scenario);
    const active = engine.getScenarioRun()!;
    assert.equal(active.id, scenario.id);
    assert.equal(active.startDay, 1);
    assert.equal(active.startingEquity, 100_000);
    assert.equal(active.settledDays, 0);
    assert.equal(engine.getSnapshot().regime, scenario.initialRegime);
  }
});

test('each scenario completes exactly after its settled days and freezes', () => {
  for (const scenario of SCENARIOS) {
    const engine = new MarketSimulationEngine(scenario.seed, 100_000);
    engine.startScenario(scenario);
    for (let day = 0; day < scenario.durationDays; day++) {
      assert.equal(engine.getScenarioRun()?.result, undefined);
      engine.skipToNextDay();
    }

    const active = engine.getScenarioRun()!;
    assert.equal(active.settledDays, scenario.durationDays);
    assert.equal(active.result?.completedDay, scenario.durationDays);
    assert.equal(active.result?.finalEquity, 100_000);
    assert.equal(active.result?.netGain, 0);
    assert.equal(active.result?.score, 0);
    assert.equal(active.result?.grade, 'D');
    assert.equal(active.result?.success, false);
    assert.equal(engine.getSnapshot().simDay, scenario.durationDays + 1);

    const before = engine.exportState();
    engine.skipToNextDay();
    engine.tick(10);
    assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, false);
    assert.equal(engine.cancelOrder('anything'), false);
    assert.deepEqual(engine.exportState(), before);
  }
});

test('scenario start is rejected outside a fresh session', () => {
  const scenario = SCENARIOS[0];
  const engine = new MarketSimulationEngine(scenario.seed, 100_000);
  engine.startScenario(scenario);
  assert.throws(() => engine.startScenario(scenario));
  const used = new MarketSimulationEngine(scenario.seed, 100_000);
  used.skipToNextDay();
  assert.throws(() => used.startScenario(scenario));
});

test('timed settlement works at 1x, 5x and 20x', () => {
  for (const speed of [1, 5, 20] as const) {
    const scenario = SCENARIOS[0];
    const engine = new MarketSimulationEngine(scenario.seed, 100_000);
    engine.startScenario(scenario);
    engine.setSpeed(speed);
    engine.tick(26_000 / (65 * speed));
    assert.equal(engine.getScenarioRun()?.settledDays, 1, `${speed}x settled once`);
    assert.equal(engine.getSnapshot().simDay, 2);
  }
});

test('mid-run and completed saves restore run progress and result', () => {
  const scenario = SCENARIOS[0];
  const engine = new MarketSimulationEngine(scenario.seed, 100_000);
  engine.startScenario(scenario);
  engine.skipToNextDay();
  const mid = new MarketSimulationEngine(scenario.seed, 100_000);
  mid.importState(engine.exportState());
  assert.equal(mid.getScenarioRun()?.settledDays, 1);
  assert.equal(mid.getScenarioRun()?.result, undefined);

  for (let day = 1; day < scenario.durationDays; day++) mid.skipToNextDay();
  const result = mid.getScenarioRun()!.result!;
  const restored = new MarketSimulationEngine(scenario.seed, 100_000);
  restored.importState(mid.exportState());
  assert.deepEqual(restored.getScenarioRun()!.result, result);
  assert.equal(restored.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, false);
});

test('unknown scenario runs and mismatched seeds are rejected on import', () => {
  const scenario = SCENARIOS[0];
  const engine = new MarketSimulationEngine(scenario.seed, 100_000);
  engine.startScenario(scenario);
  const state = engine.exportState();
  state.scenarioRun!.id = 'not_a_scenario';
  assert.throws(() => new MarketSimulationEngine(scenario.seed, 100_000).importState(state));

  const wrongSeed = engine.exportState();
  wrongSeed.seed = 'OTHER_SEED';
  assert.throws(() => new MarketSimulationEngine('OTHER_SEED', 100_000).importState(wrongSeed));
});

test('legacy non-scenario engines import without a run', () => {
  const engine = new MarketSimulationEngine('G10_LEGACY', 100_000);
  const restored = new MarketSimulationEngine('G10_LEGACY', 100_000);
  restored.importState(engine.exportState());
  assert.equal(restored.getScenarioRun(), undefined);
});

test('same seed and actions replay the same scenario settlement', () => {
  const scenario = SCENARIOS[0];
  const left = new MarketSimulationEngine(scenario.seed, 100_000);
  const right = new MarketSimulationEngine(scenario.seed, 100_000);
  left.startScenario(scenario);
  right.startScenario(scenario);
  for (let day = 0; day < scenario.durationDays; day++) {
    left.skipToNextDay();
    right.skipToNextDay();
  }
  assert.deepEqual(left.getScenarioRun(), right.getScenarioRun());
  assert.deepEqual(left.getSnapshot().riskMetrics, right.getSnapshot().riskMetrics);
});
