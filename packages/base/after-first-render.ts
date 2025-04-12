import Helper from '@ember/component/helper';
import { schedule } from '@ember/runloop';

interface Signature {
  Args: {
    Positional: [() => void];
  };
  Return: void;
}

export default class AfterFirstRender extends Helper<Signature> {
  private didRun = false;

  compute([callback]: [() => void]) {
    if (!this.didRun) {
      this.didRun = true;
      schedule('afterRender', callback);
    }
  }
}
