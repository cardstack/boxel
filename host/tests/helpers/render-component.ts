// @ts-ignore
import { precompileTemplate } from '@ember/template-compilation';
import { render } from '@ember/test-helpers';

export async function renderComponent(C: any) {
  await render(precompileTemplate(`<C/>`, { scope: () => ({ C }) }));
}
