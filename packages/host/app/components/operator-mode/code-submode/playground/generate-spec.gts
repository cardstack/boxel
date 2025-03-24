import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import type { TaskForAsyncTaskFunction } from 'ember-concurrency';

interface Signature {
  Args: {
    createNewCard: TaskForAsyncTaskFunction<unknown, () => Promise<void>>;
  };
}

export default class GenerateSpec extends Component<Signature> {
  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.createNewCard.perform();
  }
}
