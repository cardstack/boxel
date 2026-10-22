import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLElement;
}

// Dashboard v2, shown in place of the workspace chooser when the
// DASHBOARD_V2 feature flag is on.
const Dashboard: TemplateOnlyComponent<Signature> = <template>
  <section aria-label='Dashboard' data-test-dashboard ...attributes>
  </section>
</template>;

export default Dashboard;
