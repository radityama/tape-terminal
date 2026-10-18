// Seeded Pseudo-Random Number Generator (Mulberry32 + Box-Muller normal transform)
// Completely deterministic given the same numeric or string seed

export class SeededRNG {
  private state: number;

  constructor(seed: number | string = 1337) {
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
      }
      this.state = hash >>> 0;
    } else {
      this.state = seed >>> 0;
    }
    if (this.state === 0) this.state = 1337;
  }

  // Save/restore the internal counter so a restored save continues the exact same sequence.
  getState(): number {
    return this.state;
  }

  setState(state: number) {
    this.state = state >>> 0;
    if (this.state === 0) this.state = 1337;
  }

  // Returns pseudo-random uniform float in [0, 1)
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns integer in [min, max]
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Box-Muller transform for standard normal distribution N(0, 1)
  nextGaussian(mean: number = 0, stdDev: number = 1): number {
    let u1 = this.next();
    let u2 = this.next();
    while (u1 <= 1e-15) {
      u1 = this.next();
    }
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  // Pick random element from array
  pick<T>(arr: T[]): T {
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx];
  }
}
