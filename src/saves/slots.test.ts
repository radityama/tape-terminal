import { expect, test } from 'vitest';
import { chooseCareerSlot } from './slots';

test('a new career takes the first empty slot without asking', () => {
  expect(chooseCareerSlot([])).toEqual({ mode: 'auto', slot: 1 });
  expect(chooseCareerSlot([1])).toEqual({ mode: 'auto', slot: 2 });
  expect(chooseCareerSlot([1, 2])).toEqual({ mode: 'auto', slot: 3 });
  expect(chooseCareerSlot([2])).toEqual({ mode: 'auto', slot: 1 });
});

test('the slot picker only appears when all three slots are full', () => {
  expect(chooseCareerSlot([1, 2, 3])).toEqual({ mode: 'choose' });
  expect(chooseCareerSlot([3, 1, 2, 2])).toEqual({ mode: 'choose' });
});

test('slots outside the career range do not block an empty one', () => {
  expect(chooseCareerSlot([0, 4, 9])).toEqual({ mode: 'auto', slot: 1 });
  expect(chooseCareerSlot([1, 2, 4])).toEqual({ mode: 'auto', slot: 3 });
});
