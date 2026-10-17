import Decimal from 'decimal.js';

// High-precision money helper to prevent floating-point inaccuracies
// All calculations are kept in high-precision Decimal or rounded cleanly to 2 decimal places

export class Money {
  private d: Decimal;

  constructor(val: number | string | Decimal | Money) {
    if (val instanceof Money) {
      this.d = new Decimal(val.d);
    } else if (val instanceof Decimal) {
      this.d = new Decimal(val);
    } else {
      this.d = new Decimal(val || 0);
    }
  }

  static from(val: number | string | Decimal | Money): Money {
    return new Money(val);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: number | string | Decimal | Money): Money {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return new Money(this.d.plus(o));
  }

  sub(other: number | string | Decimal | Money): Money {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return new Money(this.d.minus(o));
  }

  mul(factor: number | string | Decimal | Money): Money {
    const f = factor instanceof Money ? factor.d : new Decimal(factor || 0);
    return new Money(this.d.times(f));
  }

  div(divisor: number | string | Decimal | Money): Money {
    const div = divisor instanceof Money ? divisor.d : new Decimal(divisor || 1);
    if (div.isZero()) return new Money(0);
    return new Money(this.d.dividedBy(div));
  }

  toNumber(): number {
    return this.d.toNumber();
  }

  toCents(): number {
    return Math.round(this.d.times(100).toNumber());
  }

  isPositive(): boolean {
    return this.d.greaterThan(0);
  }

  isNegative(): boolean {
    return this.d.lessThan(0);
  }

  isZero(): boolean {
    return this.d.isZero();
  }

  gte(other: number | string | Decimal | Money): boolean {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return this.d.greaterThanOrEqualTo(o);
  }

  gt(other: number | string | Decimal | Money): boolean {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return this.d.greaterThan(o);
  }

  lte(other: number | string | Decimal | Money): boolean {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return this.d.lessThanOrEqualTo(o);
  }

  lt(other: number | string | Decimal | Money): boolean {
    const o = other instanceof Money ? other.d : new Decimal(other || 0);
    return this.d.lessThan(o);
  }

  format(includeSign: boolean = false): string {
    const num = this.d.toNumber();
    const absStr = Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (num < 0) {
      return `-$${absStr}`;
    }
    if (includeSign && num > 0) {
      return `+$${absStr}`;
    }
    return `$${absStr}`;
  }
}
