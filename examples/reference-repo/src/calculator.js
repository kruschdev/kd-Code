/**
 * Reference Arithmetic Calculator
 * Used to verify Krusch sandbox contract execution and 2PC atomic apply.
 */

export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export function multiply(a, b) {
  return a * b;
}

export function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

export function power(base, exp) {
  return Math.pow(base, exp);
}
