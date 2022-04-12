import Component from "@glimmer/component";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";

export const component = setComponentTemplate(
  precompileTemplate(`
    hello world {{this.num}}
    <button {{on "click" this.increment}}>Click here</button>
  `),
  class extends Component {
    @tracked num = 0;

    @action increment() {
      this.num++;
    }
  }
);
