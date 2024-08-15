import { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

let WorkspaceChooser: TemplateOnlyComponent<Signature> = <template>
  <div class='workspace-chooser' data-test-workspace-chooser>
    <span class='workspace-chooser__title'>Your Workspaces</span>
    {{! TODO: [CS-7031] Implement list workspaces that user has access to }}
    <span class='workspace-chooser__title'>Community Catalogs</span>
  </div>
  <style>
    .workspace-chooser {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-lg);
      position: relative;
      background-color: var(--boxel-700);
      height: 100%;
      padding: 10rem 11.5rem;
    }
    .workspace-chooser__title {
      color: var(--boxel-light);
      font: 600 var(--boxel-font-lg);
      letter-spacing: var(--boxel-lsp);
    }
  </style>
</template>;

export default WorkspaceChooser;
