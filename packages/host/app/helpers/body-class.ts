import Helper from '@ember/component/helper';

interface Signature {
  Args: {
    Positional: [string];
  };
  Return: void;
}

export default class BodyClass extends Helper<Signature> {
  compute([className]: [string]) {
    document.body.classList.add(className);
  }
}
