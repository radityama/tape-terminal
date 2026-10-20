/** Two decimals normally; tiny non-zero returns use four so a loss never reads "-0.00%". */
export function formatSignedPercent(value: number | null): string {
  if (value === null) return 'N/A';
  if (value === 0) return '0.00%';
  const decimals = Math.abs(value) < 0.01 ? 4 : 2;
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}
