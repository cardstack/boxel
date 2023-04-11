import Component from '@glimmer/component';
import { LinkTo } from '@ember/routing';

interface Signature {
  Args: {};
}

export default class CodeLink extends Component<Signature> {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <p style='text-align:center;margin:5em auto;' data-test-moved>The card code
      editor has moved to
      <LinkTo
        @route='code'
        style='color:aqua;font-weight:bold;font-style:italic'
        data-test-code-link
      >/code</LinkTo>
    </p>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CodeLink: typeof CodeLink;
  }
}
