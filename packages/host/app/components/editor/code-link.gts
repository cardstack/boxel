import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';

interface Signature {
  Args: {};
}

export default class CodeLink extends Component<Signature> {
  <template>
    <footer class='footer' data-test-moved>The card code editor has moved to
      <LinkTo @route='code' class='link' data-test-code-link>/code</LinkTo>
    </footer>
    <style>
      .footer {
        text-align: center;
        margin: 0 auto;
        padding-bottom: 1em;
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Editor::CodeLink': typeof CodeLink;
  }
}
