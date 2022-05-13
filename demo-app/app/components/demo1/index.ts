import Component from '@glimmer/component';
import fade from 'animations-experiment/transitions/fade';
import dedent from '../../utils/dedent';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

export default class Demo1 extends Component {
  @tracked transitionsRunning = 0;
  @tracked guests = 1;
  @tracked animationEnabled = false;
  transition = fade;

  @action addGuest(): void {
    if (this.guests < 6) {
      this.guests = this.guests + 1;
    }
  }

  @action
  removeGuest(): void {
    if (this.guests > 1) {
      this.guests = this.guests - 1;
    }
  }
  templateDiff = dedent`
    + <AnimationContext @use={{this.transition}}>
        {{#each guests}}
    -     <Icon 'user' />
    +     <Icon 'user' {{sprite}} />
        {{/each}}
    + </AnimationContext>

  `;

  componentDiff = dedent`
      import Component from '@ember/component';
    + import fade from '../../transitions/fade';

      export default Component.extend({
    +   transition: fade,
    +
        guests: 1,

        actions: {
          addGuest() {
            if (this.guests < 6) {
              this.incrementProperty('guests');
            }
          },

          removeGuest() {
            if (this.guests > 1) {
              this.decrementProperty('guests');
            }
          }
        }
      });
  `;
}
