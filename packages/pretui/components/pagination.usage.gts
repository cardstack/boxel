// Pretui — Pagination usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Pagination } from '../structure';

class PaginationUsage extends Component {
  @tracked page = 4;
  setPage = (page: number) => (this.page = page);
  <template>
    <FreestyleUsage
      @name='Pagination'
      @description='Compact page navigation with honest disabled ends and ellipsis windows. The current page is controlled here so every path updates the readout.'
      @source='<Pagination @pages="12" … />'
    >
      <:example>
        <Pagination @page={{this.page}} @pages={{12}} @onPageChange={{this.setPage}} />
        <p class='foundation-readout'>Page {{this.page}} of 12</p>
      </:example>
      <:api as |Args|>
        <Args.Number @name='page' @value={{this.page}} @min={{1}} @max={{12}} @onInput={{this.setPage}} />
        <Args.Number @name='pages' @value={{12}} @min={{1}} />
        <Args.Number @name='defaultPage' @defaultValue={{1}} />
        <Args.Action @name='onPageChange' />
      </:api>
    </FreestyleUsage>
    <style scoped>.foundation-readout { margin: 8px 0 0; font-family: var(--font-mono); font-size: var(--text-ui-xs); color: var(--muted-foreground); }</style>
  </template>
}

export const DEMOS_PAGINATION: Record<string, unknown> = {
  Pagination: PaginationUsage,
};
