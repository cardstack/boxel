import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLElement;
}

// Dashboard v2, shown in place of the workspace chooser when the
// DASHBOARD_V2 feature flag is on.
const Dashboard: TemplateOnlyComponent<Signature> = <template>
  <section
    class='dashboard'
    aria-label='Dashboard'
    data-test-dashboard
    ...attributes
  >
  </section>

  <style scoped>
    .dashboard {
      position: absolute;
      height: 100%;
      width: 100%;
      background-color: var(--boxel-800);
      z-index: var(--host-workspace-chooser-z-index);
    }
  </style>
</template>;

export default Dashboard;
