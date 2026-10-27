// Who a share puts a key in front of, for the workspace it goes into: who can
// read the workspace, how many other people edit it (each of whom can suspend
// the share or put their own key in its place), and that requests made with
// the key run on its owner's account at the service.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { eq } from '../../helpers/truth-helpers.ts';

import type { WindowContext } from './context.ts';

interface Signature {
  Args: { realm: WindowContext['realm'] };
}

const WorkspaceMembers: TemplateOnlyComponent<Signature> = <template>
  <ul class='members' data-test-workspace-members>
    <li data-test-workspace-readers>
      {{#if (eq @realm.readableBy 'anyone')}}
        Anyone can see this workspace, signed in or not.
      {{else if (eq @realm.readableBy 'signed-in')}}
        Anyone signed in to Boxel can see this workspace.
      {{else}}
        Only its members can see this workspace.
      {{/if}}
    </li>
    <li data-test-workspace-writers>
      {{#if (eq @realm.otherWriters 0)}}
        No one else edits it.
      {{else if (eq @realm.otherWriters 1)}}
        One other person edits it, and can stop this share or put their own key
        in its place.
      {{else}}
        {{@realm.otherWriters}}
        other people edit it, and any of them can stop this share or put their
        own key in its place.
      {{/if}}
    </li>
    <li>Requests made with the key run on your account at the service, so they
      count toward your usage and billing there.</li>
  </ul>

  <style scoped>
    .members {
      margin: 0;
      padding-inline-start: var(--boxel-sp);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
    .members li + li {
      margin-top: var(--boxel-sp-4xs);
    }
  </style>
</template>;

export default WorkspaceMembers;
