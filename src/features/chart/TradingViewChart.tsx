'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CandlestickData,
  HistogramData,
  LineData,
} from 'lightweight-charts';
import { useTerminalStore, ChartTimeframe } from '../../store/useTerminalStore';
import { COMPANY_MAP } from '../../data/companies';

export function TradingViewChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerLowerRef = useRef<ISeriesApi<'Line'> | null>(null);

  const selectedTicker = useTerminalStore((s) => s.selectedTicker);
  const selectedTimeframe = useTerminalStore((s) => s.selectedTimeframe);
  const setSelectedTimeframe = useTerminalStore((s) => s.setSelectedTimeframe);
  const chartIndicators = useTerminalStore((s) => s.chartIndicators);
  const toggleChartIndicator = useTerminalStore((s) => s.toggleChartIndicator);
  const engine = useTerminalStore((s) => s.engine);
  const snapshot = useTerminalStore((s) => s.snapshot);

  const [activeTab, setActiveTab] = useState<ChartTimeframe>(selectedTimeframe);
  const company = COMPANY_MAP.get(selectedTicker);

  // Initialize and attach chart instance
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous instance if any
    if (chartInstance.current) {
      chartInstance.current.remove();
      chartInstance.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: '#0F1114' },
        textColor: '#98A0A9',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#1B1F24' },
        horzLines: { color: '#1B1F24' },
      },
      crosshair: {
        vertLine: { color: '#2F363E', width: 1, style: 2 },
        horzLine: { color: '#2F363E', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#22272D',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#22272D',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartInstance.current = chart;

    // 1. Candlestick series (v5 addSeries API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#3DB070',
      downColor: '#E5534B',
      borderVisible: false,
      wickUpColor: '#3DB070',
      wickDownColor: '#E5534B',
    });
    candleSeriesRef.current = candleSeries;

    // 2. Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // 3. Technical indicators
    const smaSeries = chart.addSeries(LineSeries, {
      color: '#E0A03A',
      lineWidth: 1,
      title: 'SMA 20',
    });
    smaSeriesRef.current = smaSeries;

    const emaSeries = chart.addSeries(LineSeries, {
      color: '#38BDF8',
      lineWidth: 1,
      title: 'EMA 50',
    });
    emaSeriesRef.current = emaSeries;

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#A855F7',
      lineWidth: 1,
      title: 'VWAP',
    });
    vwapSeriesRef.current = vwapSeries;

    const bUpper = chart.addSeries(LineSeries, {
      color: 'rgba(224, 160, 58, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
    });
    const bLower = chart.addSeries(LineSeries, {
      color: 'rgba(224, 160, 58, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
    });
    bollingerUpperRef.current = bUpper;
    bollingerLowerRef.current = bLower;

    // Resize observer for docking panel adjustment
    const ro = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chartInstance.current) return;
      const { width, height } = entries[0].contentRect;
      chartInstance.current.applyOptions({ width, height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }
    };
  }, []);

  // Update chart data whenever ticker, timeframe, or snapshot updates
  useEffect(() => {
    if (!engine || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const rawCandles = engine.getCandles(selectedTicker, activeTab);
    if (!rawCandles || rawCandles.length === 0) return;

    const candleData: CandlestickData[] = rawCandles.map((c) => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = rawCandles.map((c) => ({
      time: c.time as any,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(61, 176, 112, 0.3)' : 'rgba(229, 83, 75, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);

    if (chartIndicators.volume) {
      volumeSeriesRef.current.setData(volumeData);
    } else {
      volumeSeriesRef.current.setData([]);
    }

    // Compute SMA 20
    if (chartIndicators.sma20 && smaSeriesRef.current) {
      const smaData: LineData[] = [];
      const period = 20;
      for (let i = period - 1; i < rawCandles.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += rawCandles[i - j].close;
        }
        smaData.push({ time: rawCandles[i].time as any, value: sum / period });
      }
      smaSeriesRef.current.setData(smaData);
    } else if (smaSeriesRef.current) {
      smaSeriesRef.current.setData([]);
    }

    // Compute EMA 50
    if (chartIndicators.ema50 && emaSeriesRef.current) {
      const emaData: LineData[] = [];
      const period = 50;
      const k = 2 / (period + 1);
      let ema = rawCandles[0]?.close || 100;

      for (let i = 0; i < rawCandles.length; i++) {
        const c = rawCandles[i].close;
        ema = c * k + ema * (1 - k);
        if (i >= 20) {
          emaData.push({ time: rawCandles[i].time as any, value: ema });
        }
      }
      emaSeriesRef.current.setData(emaData);
    } else if (emaSeriesRef.current) {
      emaSeriesRef.current.setData([]);
    }

    // Compute VWAP
    if (chartIndicators.vwap && vwapSeriesRef.current) {
      let cumVol = 0;
      let cumVal = 0;
      const vwapData: LineData[] = [];
      for (let i = 0; i < rawCandles.length; i++) {
        const c = rawCandles[i];
        const typical = (c.high + c.low + c.close) / 3;
        cumVol += c.volume || 100;
        cumVal += typical * (c.volume || 100);
        vwapData.push({ time: c.time as any, value: cumVal / cumVol });
      }
      vwapSeriesRef.current.setData(vwapData);
    } else if (vwapSeriesRef.current) {
      vwapSeriesRef.current.setData([]);
    }

    // Compute Bollinger Bands (20, 2)
    if (chartIndicators.bollinger && bollingerUpperRef.current && bollingerLowerRef.current) {
      const upperData: LineData[] = [];
      const lowerData: LineData[] = [];
      const period = 20;

      for (let i = period - 1; i < rawCandles.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += rawCandles[i - j].close;
        const mean = sum / period;

        let varSum = 0;
        for (let j = 0; j < period; j++) varSum += (rawCandles[i - j].close - mean) ** 2;
        const std = Math.sqrt(varSum / period);

        upperData.push({ time: rawCandles[i].time as any, value: mean + 2 * std });
        lowerData.push({ time: rawCandles[i].time as any, value: mean - 2 * std });
      }

      bollingerUpperRef.current.setData(upperData);
      bollingerLowerRef.current.setData(lowerData);
    } else {
      bollingerUpperRef.current?.setData([]);
      bollingerLowerRef.current?.setData([]);
    }
  }, [selectedTicker, activeTab, snapshot, chartIndicators, engine]);

  const handleTimeframeChange = (tf: ChartTimeframe) => {
    setActiveTab(tf);
    setSelectedTimeframe(tf);
  };

  const currentPriceObj = snapshot?.prices.find((p) => p.ticker === selectedTicker);
  const currentPrice = currentPriceObj?.price ?? company?.initialPrice ?? 100;
  const currentChg = currentPriceObj?.change ?? 0;
  const currentChgPct = currentPriceObj?.changePercent ?? 0;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-1)] select-none" id="tutorial-chart">
      {/* Chart Top Control Bar */}
      <div className="h-[28px] border-b border-[var(--line)] px-2.5 flex items-center justify-between shrink-0 bg-[var(--bg-1)]">
        {/* Left: Ticker & Live Price Quote */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-mono">
            <span className="font-bold text-[14px] text-[var(--text-1)]">{selectedTicker}</span>
            <span className="text-[11px] text-[var(--text-3)]">{company?.name}</span>
          </div>

          <div className="flex items-center space-x-1.5 font-mono text-[12px]">
            <span className="font-semibold text-[var(--text-1)]">${currentPrice.toFixed(2)}</span>
            <span className={`text-[11px] ${currentChg >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
              {currentChg >= 0 ? `+${currentChg.toFixed(2)}` : `${currentChg.toFixed(2)}`} ({currentChgPct >= 0 ? '+' : ''}{currentChgPct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Center: Timeframe Tabs */}
        <div className="flex items-center space-x-0.5 bg-[var(--bg-0)] p-0.5 rounded-[2px] border border-[var(--line)]">
          {(['1m', '5m', '15m', '1h', '1D'] as ChartTimeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => handleTimeframeChange(tf)}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded-[2px] transition-colors cursor-pointer ${
                activeTab === tf
                  ? 'bg-[var(--accent)] text-[var(--bg-0)] font-semibold'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Right: Technical Indicator Toggles */}
        <div className="flex items-center space-x-1 text-[10px] font-mono">
          <button
            onClick={() => toggleChartIndicator('sma20')}
            className={`px-1.5 py-0.5 rounded-[2px] border cursor-pointer ${
              chartIndicators.sma20
                ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            SMA
          </button>
          <button
            onClick={() => toggleChartIndicator('ema50')}
            className={`px-1.5 py-0.5 rounded-[2px] border cursor-pointer ${
              chartIndicators.ema50
                ? 'bg-[#38BDF8]/15 border-[#38BDF8] text-[#38BDF8]'
                : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            EMA
          </button>
          <button
            onClick={() => toggleChartIndicator('vwap')}
            className={`px-1.5 py-0.5 rounded-[2px] border cursor-pointer ${
              chartIndicators.vwap
                ? 'bg-[#A855F7]/15 border-[#A855F7] text-[#A855F7]'
                : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            VWAP
          </button>
          <button
            onClick={() => toggleChartIndicator('bollinger')}
            className={`px-1.5 py-0.5 rounded-[2px] border cursor-pointer ${
              chartIndicators.bollinger
                ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            BB
          </button>
          <button
            onClick={() => toggleChartIndicator('volume')}
            className={`px-1.5 py-0.5 rounded-[2px] border cursor-pointer ${
              chartIndicators.volume
                ? 'bg-[var(--bg-2)] border-[var(--line-strong)] text-[var(--text-1)]'
                : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            VOL
          </button>
        </div>
      </div>

      {/* Chart Canvas Container */}
      <div className="flex-1 w-full h-full relative" ref={containerRef} />
    </div>
  );
}
