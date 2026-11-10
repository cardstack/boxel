// Picks a workspace from a list, as the key pages that share or use a key ask
// for one: Pret UI's Select, searched by name, each workspace by its name and,
// where another in the list has the same name, its address. With none to
// pick, the page's own message says why.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Select } from '@cardstack/pretui/components/select';

import { type Workspace, workspaceOptions } from './workspaces.ts';

interface Signature {
  Args: {
    workspaces: Workspace[];
    selected: string | undefined;
    onSelect: (url: string) => void;
    // The id of the label that names the picker.
    labelId?: string;
    // What the page says when there is no workspace to pick.
    emptyMessage: string;
  };
}

const WorkspacePicker: TemplateOnlyComponent<Signature> = <template>
  {{#if @workspaces.length}}
    <Select
      @options={{workspaceOptions @workspaces}}
      @value={{@selected}}
      @onValueChange={{@onSelect}}
      @placeholder='Select a workspace'
      @searchEnabled={{true}}
      @labelledBy={{@labelId}}
      data-test-workspace-dropdown
    />
  {{else}}
    <p class='no-workspaces' data-test-workspace-dropdown-no-results>
      {{@emptyMessage}}
    </p>
  {{/if}}
  <style scoped>
    .no-workspaces {
      margin: 0;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default WorkspacePicker;
