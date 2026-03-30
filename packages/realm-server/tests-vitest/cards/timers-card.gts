import { CardDef, Component } from 'https://cardstack.com/base/card-api';

// Success is the worker being able to process this module and not die/thrash
export class TimersCard extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{this.mischief}}
    </template>

    get mischief() {
      setTimeout(() => {
        throw new Error(
          `I'm an intentional error being thrown in a setTimeout() in the timers-card.gts module`,
        );
      }, 100);
      setInterval(() => {
        throw new Error(
          `I'm an intentional error being thrown in a setInterval() in the timers-card.gts module`,
        );
      }, 100);
      return '';
    }
  };
}
