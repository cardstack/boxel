// Pretui — AppShell usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { AppShell } from './app-shell';

const SOURCE = `<AppShell @label='Roastery' @navLabel='Sections'>
  <:masthead>…</:masthead>
  <:navigation>…</:navigation>
  <:default>…</:default>
</AppShell>`;

const AppShellUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='AppShell'
    @description='PageScaffold under the Mantine name (Ant calls it Layout): the named regions masthead, navigation, main, aside and footer, each its landmark and rendered only when supplied. Import it when a port already says AppShell; the component and its writeup are PageScaffold. A collapsible rail is Sidebar inside the navigation block.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='as-demo'>
        <AppShell @label='Roastery' @navLabel='Sections'>
          <:masthead><strong>Northwind Roasters</strong></:masthead>
          <:navigation><ul class='as-demo-nav'><li>Lots</li><li>Roasts</li><li>Orders</li></ul></:navigation>
          <:default><p>Lot 7 · Huila, washed · roasting Thursday</p></:default>
        </AppShell>
      </div>
    </:example>
    <:api as |Args|>
      <Args.String @name='label' @description='Names the main region.' />
      <Args.String @name='navLabel' />
      <Args.String @name='asideLabel' />
      <Args.Bool @name='skipLink' @description='Adds a SkipLink to the main region.' />
      <Args.Yield @name='masthead' />
      <Args.Yield @name='navigation' />
      <Args.Yield @name='default' />
      <Args.Yield @name='aside' />
      <Args.Yield @name='footer' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .as-demo {
      block-size: 14rem;
    }
    .as-demo-nav {
      margin: 0;
      padding-inline-start: 1rem;
    }
  </style>
</template>;

export const DEMOS_APP_SHELL: Record<string, unknown> = {
  AppShell: AppShellUsage,
};
