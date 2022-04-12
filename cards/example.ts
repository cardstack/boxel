import Component from "@glimmer/component";
// @ts-ignore this import is compiled out, so there is no concrete module behind it
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";

export const component = setComponentTemplate(
  precompileTemplate("{{this.message}}"),
  class extends Component {
    get message(): string {
      return "Hello world I'm TS";
    }
  }
);
