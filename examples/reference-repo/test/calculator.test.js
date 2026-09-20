import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add, subtract, multiply, divide, power } from '../src/calculator.js';

describe('Calculator Operations', () => {
  it('correctly adds numbers', () => {
    assert.equal(add(2, 3), 5);
    assert.equal(add(-5, 5), 0);
  });

  it('correctly subtracts numbers', () => {
    assert.equal(subtract(10, 4), 6);
  });

  it('correctly multiplies numbers', () => {
    assert.equal(multiply(6, 7), 42);
  });

  it('correctly divides numbers and guards zero-division', () => {
    assert.equal(divide(100, 4), 25);
    assert.throws(() => divide(10, 0), /Division by zero/);
  });

  it('correctly computes exponentiation', () => {
    assert.equal(power(2, 8), 256);
  });
});
