import Modifier from 'ember-modifier';

interface ConsumeContextSignature {
  Args: {
    Named: {
      consume: () => void;
    };
  };
}

// you cannot consume context from ember-provide-consume-context in the
// constructor as the provider is wired up as part of the DOM rendering. So
// this modifier allows us to consume context as soon as its available to be
// consumed.
export default class ConsumeContext extends Modifier<ConsumeContextSignature> {
  modify(
    _element: HTMLElement,
    _positional: [],
    { consume }: ConsumeContextSignature['Args']['Named'],
  ) {
    consume();
  }
}
