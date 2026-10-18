'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { ArrowRight, ArrowLeft, X, Check } from '@phosphor-icons/react';

interface StepDef {
  step: number;
  title: string;
  copy: string;
  targetSelector?: string;
  isActionRequired?: boolean;
}

const STEPS: StepDef[] = [
  {
    step: 1,
    title: 'Welcome to TAPE',
    copy: 'You manage a $100,000 trading account. Grow it, stay inside your risk limits, and climb the career ladder. This takes about two minutes.',
  },
  {
    step: 2,
    title: 'Watchlist',
    copy: 'Your stocks live here. Green means up, red means down. Click any ticker to load it.',
    targetSelector: '#tutorial-watchlist',
  },
  {
    step: 3,
    title: 'Interactive Chart',
    copy: 'Each candle is one slice of trading time. Use the timeframe tabs to zoom in or out, and add indicators from the toolbar.',
    targetSelector: '#tutorial-chart',
  },
  {
    step: 4,
    title: 'News & Macro Wire',
    copy: 'Prices move on news and earnings. Headlines are not always what they seem, so read carefully.',
    targetSelector: '#tutorial-news',
  },
  {
    step: 5,
    title: 'Order Ticket & Pre-Trade Preview',
    copy: 'Pick Buy or Sell, a quantity and an order type. Before you confirm, the ticket shows the estimated price, fees and what your account will look like after.',
    targetSelector: '#tutorial-ticket',
  },
  {
    step: 6,
    title: 'Guided First Trade',
    copy: 'Try it. Press Buy to open your first position.',
    targetSelector: '#tutorial-ticket',
    isActionRequired: true,
  },
  {
    step: 7,
    title: 'Positions & Risk Analytics',
    copy: 'Open positions and live profit and loss appear here. Watch your buying power and keep one stock from becoming most of your account.',
    targetSelector: '#tutorial-positions-risk',
  },
  {
    step: 8,
    title: 'Speed & Clock Control',
    copy: 'The market runs on a compressed clock. Pause, speed up, or skip to the next event. Press Space to pause any time.',
    targetSelector: '#tutorial-sim-clock',
  },
  {
    step: 9,
    title: 'Command Terminal & Career Ladder',
    copy: 'Press / to jump anywhere. Type a ticker or a command like BUY HLVG 100. Open the career panel to see your first objective.',
    targetSelector: '#tutorial-command-bar',
  },
];

export function SpotlightTutorial() {
  const tutorialActive = useTerminalStore((s) => s.tutorialActive);
  const currentStep = useTerminalStore((s) => s.tutorialStep);
  const nextStep = useTerminalStore((s) => s.nextTutorialStep);
  const prevStep = useTerminalStore((s) => s.prevTutorialStep);
  const skipTutorial = useTerminalStore((s) => s.skipTutorial);
  const setSelectedTicker = useTerminalStore((s) => s.setSelectedTicker);

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const stepDef = STEPS[currentStep - 1] || STEPS[0];

  // If entering step 6 (guided first trade), ensure liquid stock is pre-selected
  useEffect(() => {
    if (tutorialActive && currentStep === 6) {
      setSelectedTicker('HLVG');
    }
  }, [tutorialActive, currentStep, setSelectedTicker]);

  // Update spotlight rect when step changes or window resizes
  useEffect(() => {
    if (!tutorialActive) return;

    const updateRect = () => {
      if (stepDef.targetSelector) {
        const el = document.querySelector(stepDef.targetSelector);
        if (el) {
          setTargetRect(el.getBoundingClientRect());
          return;
        }
      }
      setTargetRect(null);
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [tutorialActive, currentStep, stepDef]);

  // Keyboard navigation
  useEffect(() => {
    if (!tutorialActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipTutorial();
      } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && !stepDef.isActionRequired) {
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        prevStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tutorialActive, currentStep, stepDef, nextStep, prevStep, skipTutorial]);

  if (!tutorialActive) return null;

  // Calculate card positioning relative to target rect
  let cardStyle: React.CSSProperties = {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  };

  if (targetRect) {
    // If target is in right half of screen, put card on the left
    const placeLeft = targetRect.left > window.innerWidth / 2;
    const cardTop = Math.max(60, Math.min(window.innerHeight - 240, targetRect.top + 20));

    cardStyle = {
      top: `${cardTop}px`,
      left: placeLeft ? `${Math.max(20, targetRect.left - 340)}px` : `${Math.min(window.innerWidth - 340, targetRect.right + 20)}px`,
      transform: 'none',
    };
  }

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
    >
      {/* Dimmed background overlay with cutout around targetRect */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 4}
                y={targetRect.top - 4}
                width={targetRect.width + 8}
                height={targetRect.height + 8}
                rx="3"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Target focus ring if element is selected */}
      {targetRect && (
        <div
          className="absolute border-2 border-[var(--accent)] rounded-[2px] pointer-events-none transition-all duration-200"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      {/* Persistent Skip Link (Always reachable) */}
      <div className="absolute top-3 right-4 z-50">
        <button
          onClick={skipTutorial}
          className="px-2.5 py-1 text-[11px] font-mono text-[var(--text-2)] hover:text-white bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] cursor-pointer"
        >
          Skip tutorial (Esc)
        </button>
      </div>

      {/* Coach Card */}
      <div
        ref={cardRef}
        style={cardStyle}
        className="absolute w-[320px] bg-[var(--bg-1)] border border-[var(--accent)] rounded-[2px] p-3.5 shadow-float z-50 font-sans"
      >
        <div className="flex justify-between items-center mb-1.5 border-b border-[var(--line)] pb-1.5">
          <span className="font-mono text-[10px] text-[var(--accent)] uppercase font-bold tracking-wider">
            Step {stepDef.step} of {STEPS.length}
          </span>
          <span className="font-mono text-[10px] text-[var(--text-3)]">
            TAPE Onboarding
          </span>
        </div>

        <h3 className="text-[13px] font-bold text-[var(--text-1)] mb-1">
          {stepDef.title}
        </h3>

        <p className="text-[11px] text-[var(--text-2)] leading-relaxed mb-3">
          {stepDef.copy}
        </p>

        {/* Buttons / Actions */}
        <div className="flex justify-between items-center pt-1 border-t border-[var(--line)]">
          <div className="flex items-center space-x-1">
            {stepDef.step > 1 && (
              <button
                onClick={prevStep}
                className="px-2 py-1 text-[10px] font-mono bg-[var(--bg-0)] hover:bg-[var(--line)] text-[var(--text-2)] rounded-[2px] cursor-pointer flex items-center space-x-1"
              >
                <ArrowLeft size={10} weight="bold" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {stepDef.isActionRequired ? (
              <button
                onClick={nextStep}
                className="text-[10px] font-mono text-[var(--text-3)] hover:text-[var(--text-2)] underline cursor-pointer pr-1"
              >
                Skip this step
              </button>
            ) : (
              <button
                onClick={nextStep}
                className="px-3 py-1 bg-[var(--accent)] hover:brightness-105 text-[var(--bg-0)] font-semibold text-[11px] font-mono rounded-[2px] cursor-pointer flex items-center space-x-1"
              >
                <span>{stepDef.step === STEPS.length ? 'Start trading' : 'Next'}</span>
                <ArrowRight size={11} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
