import Component from '@glimmer/component';
import { LinkTo } from '@ember/routing';

interface Signature {
  Args: {};
}

export default class CodeLink extends Component<Signature> {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <footer style='text-align:center;margin:1em auto;' data-test-moved>The card
      code editor has moved to
      <LinkTo @route='code' class='link' data-test-code-link>/code</LinkTo>
    </footer>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CodeLink: typeof CodeLink;
  }
}
