// @ts-ignore
import { precompileTemplate } from '@ember/template-compilation';
import { render } from '@ember/test-helpers';
import {
  Format,
  prepareToRender,
  Card,
  RenderOptions,
} from 'runtime-spike/lib/card-api';
import { ComponentLike } from '@glint/template';

export async function renderComponent(C: ComponentLike) {
  await render(precompileTemplate(`<C/>`, { scope: () => ({ C }) }));
}

export async function renderCard(
  card: Card,
  format: Format,
  opts?: RenderOptions
): Promise<void> {
  let { component } = await prepareToRender(card, format, opts);
  await renderComponent(component);
}
