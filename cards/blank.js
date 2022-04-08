import Component from "@glimmer/component";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";

export const component = setComponentTemplate(
  precompileTemplate("hello world"),
  class extends Component {}
);
