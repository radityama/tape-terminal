import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata: Metadata = {
  title: 'TAPE: Stock Trading Terminal & Simulation Game',
  description: 'Professional browser-based stock trading game and financial terminal with realistic market microstructure, 48 equities across 8 sectors, macroeconomic events, and career progression.',
  openGraph: {
    title: 'TAPE: Stock Trading Terminal & Simulation Game',
    description: 'Professional browser-based stock trading game and financial terminal with realistic market microstructure, 48 equities across 8 sectors, macroeconomic events, and career progression.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TAPE: Stock Trading Terminal & Simulation Game',
    description: 'Professional browser-based stock trading game and financial terminal with realistic market microstructure, 48 equities across 8 sectors, macroeconomic events, and career progression.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-[var(--bg-0)] text-[var(--text-1)] font-sans antialiased selection:bg-[var(--accent)] selection:text-black min-h-[100dvh]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
