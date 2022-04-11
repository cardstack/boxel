import Component from "@glimmer/component";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";
import { tracked } from "@glimmer/tracking";

export const component = setComponentTemplate(
  precompileTemplate(`
    hello world {{this.num}}
  `),
  class extends Component {
    @tracked num = 1;
  }
);
