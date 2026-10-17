import React from 'react';

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[var(--bg-0)]">
      {children}
    </div>
  );
}
