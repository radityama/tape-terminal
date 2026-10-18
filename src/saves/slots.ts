// Career slot placement is pure so the title screen can be tested without a browser.
export const CAREER_SLOTS = [1, 2, 3] as const;

export type CareerSlotChoice = { mode: 'auto'; slot: number } | { mode: 'choose' };

// A new career takes the first empty slot silently; a slot picker is only needed when
// all three slots already hold a save.
export function chooseCareerSlot(occupied: readonly number[]): CareerSlotChoice {
  const taken = new Set(occupied);
  const empty = CAREER_SLOTS.find((slot) => !taken.has(slot));
  return empty ? { mode: 'auto', slot: empty } : { mode: 'choose' };
}
