import Helper from '@ember/component/helper';
import { schedule } from '@ember/runloop';

interface Signature {
  Args: {
    Positional: [() => void];
  };
  Return: void;
}

export default class extends Helper<Signature> {
  private didRun = false;

  compute([consume]: [() => void]) {
    if (!this.didRun) {
      this.didRun = true;
      schedule('afterRender', consume);
    }
  }
}
