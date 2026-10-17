'use client';

import React, { useState, useEffect } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { saveManager, LoadOutcome } from '../../saves/manager';
import { SaveMeta } from '../../saves/schema';
import { SaveStatusRow } from '../auth/SyncIndicator';
import { X, FloppyDisk, DownloadSimple, UploadSimple, ArrowClockwise } from '@phosphor-icons/react';

export function SettingsModal() {
  const activeModal = useTerminalStore((s) => s.activeModal);
  const setActiveModal = useTerminalStore((s) => s.setActiveModal);
  const seed = useTerminalStore((s) => s.seed);
  const difficulty = useTerminalStore((s) => s.difficulty);
  const setDifficulty = useTerminalStore((s) => s.setDifficulty);
  const soundEnabled = useTerminalStore((s) => s.soundEnabled);
  const toggleSound = useTerminalStore((s) => s.toggleSound);
  const tapeStripEnabled = useTerminalStore((s) => s.tapeStripEnabled);
  const toggleTapeStrip = useTerminalStore((s) => s.toggleTapeStrip);
  const priceFlashSetting = useTerminalStore((s) => s.priceFlashSetting);
  const setPriceFlashSetting = useTerminalStore((s) => s.setPriceFlashSetting);
  const initEngine = useTerminalStore((s) => s.initEngine);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const addToast = useTerminalStore((s) => s.addToast);

  const [savesList, setSavesList] = useState<SaveMeta[]>([]);
  const [customSeed, setCustomSeed] = useState(seed);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);

  const refreshSlots = () => {
    saveManager.listSlots().then(setSavesList);
  };

  useEffect(() => {
    if (activeModal === 'settings') {
      refreshSlots();
    }
  }, [activeModal]);

  if (activeModal !== 'settings' || !snapshot) return null;

  const loadFailureMessage = (outcome: LoadOutcome) => {
    if (outcome.ok) return '';
    if (outcome.reason === 'missing') return 'That save slot is empty.';
    if (outcome.reason === 'newer') return 'This save was made by a newer version of TAPE. Update to load it.';
    return 'This save is damaged and was not changed. You can still export the raw file.';
  };

  const handleManualSave = async (slot: number) => {
    const result = await saveManager.save(slot);
    if (result.ok) {
      addToast({ title: 'Game Saved', message: `Saved progress to slot ${slot}.`, type: 'success' });
      refreshSlots();
    } else {
      addToast({
        title: 'Save Failed',
        message:
          result.reason === 'too_large'
            ? 'This save is too large to store.'
            : result.reason === 'invalid'
              ? result.message
              : 'The save changed elsewhere. Reopen the slot and try again.',
        type: 'error',
      });
    }
  };

  const handleLoadSave = async (slot: number) => {
    const outcome = await saveManager.load(slot);
    if (outcome.ok) {
      addToast({ title: 'Game Loaded', message: `Restored session from ${outcome.save.name}.`, type: 'info' });
      setActiveModal('none');
    } else {
      addToast({ title: 'Load Failed', message: loadFailureMessage(outcome), type: 'error' });
    }
  };

  const handleExport = async (slot: number) => {
    const jsonStr = await saveManager.exportJson(slot);
    if (jsonStr) {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tape_save_slot${slot}_day${snapshot.simDay}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImportSubmit = async () => {
    if (!importJsonText.trim()) return;
    const result = await saveManager.importJson(importJsonText);
    if (result.ok) {
      addToast({ title: 'Save Imported', message: 'Imported save file successfully.', type: 'success' });
      setShowImportBox(false);
      setImportJsonText('');
      refreshSlots();
    } else {
      addToast({
        title: 'Import Failed',
        message:
          result.reason === 'too_large'
            ? 'That save is too large to import.'
            : result.reason === 'invalid'
              ? result.message
              : 'Invalid save file.',
        type: 'error',
      });
    }
  };

  const handleApplySeed = () => {
    if (customSeed.trim()) {
      const slot = saveManager.getActiveSlot();
      const replaced = window.confirm('Generating a new universe replaces the current career in this slot. Continue?');
      if (!replaced) return;
      initEngine(customSeed.trim(), 'career', 100000);
      void saveManager.save(slot, { force: true });
      addToast({ title: 'Seed Applied', message: `New universe generated with seed: ${customSeed.trim()}.`, type: 'info' });
      setActiveModal('none');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className="bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-10 border-b border-[var(--line)] px-4 flex items-center justify-between bg-[var(--bg-0)] shrink-0">
          <span className="font-bold font-mono text-[13px] text-[var(--text-1)]">
            Terminal Settings & Save Slots
          </span>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1 rounded-[2px] hover:bg-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Difficulty Preset */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-2">
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block">
              Simulation Difficulty Preset
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'learner', name: 'Learner', desc: 'Wider spreads off, fewer black swans, coaching hints enabled' },
                { id: 'standard', name: 'Standard', desc: 'Balanced market microstructure and realistic liquidity' },
                { id: 'hardcore', name: 'Hardcore', desc: 'Full slippage friction, no hints, strict margin calls' },
              ].map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDifficulty(d.id as any)}
                  className={`p-2.5 rounded-[2px] border text-left cursor-pointer transition-colors ${
                    difficulty === d.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--line)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)]'
                  }`}
                >
                  <div className="font-mono text-[12px] font-bold text-[var(--text-1)]">{d.name}</div>
                  <div className="text-[10px] text-[var(--text-3)] mt-0.5 font-sans leading-tight">{d.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Price Flash Settings */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-2">
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block">
              Watchlist Price Flash Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'off', name: 'Off', desc: 'Text color and glyphs only, no flashing overlay (forced if prefers-reduced-motion)' },
                { id: 'subtle', name: 'Subtle (Default)', desc: 'Calm 16% opacity tint, 700ms smooth fade, 1.5s per-cell throttle' },
                { id: 'full', name: 'Full', desc: 'Higher opacity tint with speed-aware per-cell throttle' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setPriceFlashSetting(m.id as any)}
                  className={`p-2.5 rounded-[2px] border text-left cursor-pointer transition-colors ${
                    priceFlashSetting === m.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--line)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)]'
                  }`}
                >
                  <div className="font-mono text-[12px] font-bold text-[var(--text-1)]">{m.name}</div>
                  <div className="text-[10px] text-[var(--text-3)] mt-0.5 font-sans leading-tight">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Display & Audio Toggles */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-2">
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block">
              Interface & Audio Preferences
            </label>
            <div className="space-y-2 text-[12px] font-mono">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tapeStripEnabled}
                  onChange={toggleTapeStrip}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[var(--text-2)]">Enable scrolling TAPE ticker strip at top</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={toggleSound}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[var(--text-2)]">Enable market bell and execution audio</span>
              </label>
            </div>
          </div>

          {/* Seed Input */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-2">
            <label className="text-[10px] uppercase font-mono text-[var(--text-3)] block">
              Market Generation Seed
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={customSeed}
                onChange={(e) => setCustomSeed(e.target.value)}
                className="flex-1 bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px] px-2 py-1 text-[12px] font-mono text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleApplySeed}
                className="px-3 py-1 bg-[var(--accent)] text-black font-semibold font-mono text-[11px] rounded-[2px] cursor-pointer"
              >
                Apply Seed & Restart
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-3)] font-sans">
              The same seed reproduces the exact same price path, news events, and corporate earnings.
            </p>
          </div>

          {/* IndexedDB Save Slots */}
          <div className="bg-[var(--bg-0)] p-3 border border-[var(--line)] rounded-[2px] space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-[10px] uppercase font-mono text-[var(--text-3)]">
                Save Slots (Autosaves daily and on pause)
              </label>
              <button
                onClick={() => setShowImportBox(!showImportBox)}
                className="text-[10px] font-mono text-[var(--accent)] hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <UploadSimple size={12} weight="bold" />
                <span>Import JSON</span>
              </button>
            </div>

            <SaveStatusRow />

            {showImportBox && (
              <div className="p-2 bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px] space-y-2">
                <textarea
                  rows={4}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder="Paste exported save game JSON string here..."
                  className="w-full bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] p-2 text-[10px] font-mono text-[var(--text-1)] outline-none"
                />
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setShowImportBox(false)}
                    className="px-2 py-1 bg-[var(--bg-2)] text-[10px] rounded-[2px] text-[var(--text-2)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportSubmit}
                    className="px-3 py-1 bg-[var(--accent)] text-black text-[10px] font-semibold rounded-[2px] cursor-pointer"
                  >
                    Confirm Import
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5 font-mono text-[11px]">
              {[1, 2, 3].map((slot) => {
                const existing = savesList.find((s) => s.slot === slot);
                return (
                  <div key={slot} className="flex justify-between items-center p-2 bg-[var(--bg-1)] border border-[var(--line)] rounded-[2px]">
                    <div>
                      <div className="font-semibold text-[var(--text-1)]">Slot {slot}</div>
                      {existing ? (
                        <div className="text-[10px] text-[var(--text-3)]">
                          Day {existing.simDay} | Equity ${existing.equity.toLocaleString()} | {new Date(existing.updatedAt).toLocaleDateString()}
                        </div>
                      ) : (
                        <div className="text-[10px] text-[var(--text-3)]">Empty Slot</div>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => handleManualSave(slot)}
                        className="px-2 py-1 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[10px] text-[var(--text-2)] flex items-center space-x-1 cursor-pointer"
                      >
                        <FloppyDisk size={12} weight="bold" />
                        <span>Save</span>
                      </button>

                      {existing && (
                        <>
                          <button
                            onClick={() => handleLoadSave(slot)}
                            className="px-2 py-1 bg-[var(--accent)] hover:brightness-105 text-black font-semibold rounded-[2px] text-[10px] cursor-pointer"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => handleExport(slot)}
                            className="p-1 bg-[var(--bg-2)] hover:bg-[var(--line)] border border-[var(--line)] rounded-[2px] text-[var(--text-2)] cursor-pointer"
                            title="Export to JSON"
                          >
                            <DownloadSimple size={12} weight="bold" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
