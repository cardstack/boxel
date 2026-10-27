// Who a share puts a key in front of, for the workspace it goes into, as two
// rows: who can use the key there, and that its requests are billed to the
// key's owner. A permissions policy can let in people the workspace's
// permission rows don't name, and nothing can list who a policy admits, so a
// members-only workspace is described as its members and its policy.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import CreditCard from '../../components/icons/credit-card.gts';
import Users from '../../components/icons/users.gts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { WindowContext } from './context.ts';

interface Signature {
  Args: { realm: WindowContext['realm'] };
}

const WorkspaceMembers: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
    @label='Who can use it in this workspace'
    @icon={{Users}}
  >
    <p class='value' data-test-workspace-readers>
      {{#if (eq @realm.readableBy 'anyone')}}
        Anyone, signed in or not
      {{else if (eq @realm.readableBy 'signed-in')}}
        Anyone signed in to Boxel
      {{else}}
        Members of this workspace, and anyone its permissions policy lets in
      {{/if}}
    </p>
  </FieldContainer>
  <FieldContainer @tag='div' @label='Billing' @icon={{CreditCard}}>
    <p class='value' data-test-workspace-billing>Requests made with this key are
      billed to your account at the service.</p>
  </FieldContainer>

  <style scoped>
    .value {
      margin: 0;
      padding-top: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
  </style>
</template>;

export default WorkspaceMembers;
