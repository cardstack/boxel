// What a key page shows once its change is made: what was done, and a Close
// button. The page also tries to close the window; one the user opened
// themselves can't be closed by script, and stays on this.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import CheckMark from '../../components/icons/check-mark.gts';

interface Signature {
  Args: {
    heading: string;
    onClose: () => void;
  };
  Blocks: { default: [] };
}

const DonePage: TemplateOnlyComponent<Signature> = <template>
  <section class='done' role='status' data-test-keys-done>
    <span class='check' aria-hidden='true'><CheckMark /></span>
    <h1 class='heading' data-test-keys-done-heading>{{@heading}}</h1>
    <p class='info'>{{yield}}</p>
    <Button
      @kind='primary'
      @size='touch'
      class='close'
      data-test-keys-done-close
      {{on 'click' @onClose}}
    >Close</Button>
  </section>

  <style scoped>
    .done {
      margin-top: var(--boxel-sp-xl);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .check {
      --icon-color: var(--boxel-dark);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background-color: var(--boxel-highlight);
      margin-bottom: var(--boxel-sp);
    }
    .check :deep(svg) {
      width: 1rem;
      height: 1rem;
    }
    .heading {
      font: 600 var(--boxel-font-md);
      margin: 0 0 var(--boxel-sp-xs);
    }
    .info {
      margin: 0 0 var(--boxel-sp-lg);
      letter-spacing: var(--boxel-lsp);
      line-height: 20px;
      overflow-wrap: anywhere;
    }
    .close {
      width: 100%;
    }
  </style>
</template>;

export default DonePage;
