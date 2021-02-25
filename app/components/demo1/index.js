import Component from '@ember/component';
import fade from '../../transitions/fade';
import dedent from '../../utils/dedent';

export default Component.extend({
  transitionsRunning: 0,

  guests: 1,

  transition: fade,

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
    },
  },

  templateDiff: dedent`
    + <AnimationContext @use={{this.transition}} as |context|>
        {{#each guests}}
    -     <Icon 'user' />
    +     <Icon 'user' {{sprite context=context}} />
        {{/each}}
    + </AnimationContext>

  `,

  componentDiff: dedent`
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
  `,
});
