// The signed-in account at the top of an OAuth page, with "Not you? Sign
// out": the authorize page's consent and the device page both show it, so the
// user can see whose account an app would be connected to before they answer.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/pretui/components/button';

interface Signature {
  Element: HTMLParagraphElement;
  Args: {
    // The account as the page names it: an email, a display name, or a
    // Matrix ID.
    account: string;
    // While an answer is being sent: signing out waits.
    disabled?: boolean;
    onSignOut: () => void;
  };
}

const AccountLine: TemplateOnlyComponent<Signature> = <template>
  <p class='account' ...attributes>
    <span data-test-authorize-account>{{@account}}</span>
    <Button
      type='button'
      class='sign-out'
      @variant='link'
      @disabled={{@disabled}}
      {{on 'click' @onSignOut}}
      data-test-authorize-sign-out
    >Not you? Sign out</Button>
  </p>

  <style scoped>
    .account {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--boxel-sp-3xs);
      margin: 0;
      color: var(--muted-foreground);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .sign-out {
      --pretui-button-fg: var(
        --boxel-button-link-primary-foreground,
        var(--primary)
      );
      min-height: 0;
      padding-block: 0;
      border: 0;
      font-size: inherit;
      line-height: inherit;
    }
  </style>
</template>;

export default AccountLine;
