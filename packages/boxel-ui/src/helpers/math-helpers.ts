export function add(number1: number, number2: number): number {
  return number1 + number2;
}

export function subtract(number1: number, number2: number): number {
  return number1 - number2;
}

export function multiply(number1: number, number2: number): number {
  return number1 * number2;
}

export function divide(number1: number, number2: number): number {
  if (number2 === 0) {
    throw new Error('Cannot divide by zero');
  }
  return number1 / number2;
}
