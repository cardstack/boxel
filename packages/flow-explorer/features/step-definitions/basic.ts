import { Given, When, Then } from '@cucumber/cucumber';

function assert(
  condition: any,
  message: string = 'Assertion failed',
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Given('I have a number {int}', function (number: number) {
  this.a = number;
});
