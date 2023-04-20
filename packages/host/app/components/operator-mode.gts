import Component from '@glimmer/component';
import { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    firstCardInStack: Card;
  };
}

export default class OperatorMode extends Component<Signature> {
  stack: Card[] = [];

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.stack = [this.args.firstCardInStack];
  }

  <template>
    <div class='operator-mode-desktop-overlay'>
      <div class='operator-mode-card-stack'>
        {{#each this.stack as |card|}}
          <div class='operator-mode-stack-card'>
            <card />
          </div>
        {{/each}}

        <div>
          <br />

          {{! TODO open card chooser }}
          ➕ Add a new card to this collection
        </div>
      </div>
    </div>
  </template>
}
