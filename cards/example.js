import Component from "@glimmer/component";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";

export const component = setComponentTemplate(
  precompileTemplate("Hello world I'm JS"),
  class extends Component {}
);
