// @ts-ignore
import { precompileTemplate } from '@ember/template-compilation';
import { render, getContext } from '@ember/test-helpers';
import { ComponentLike } from '@glint/template';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import { baseRealm, Loader } from '@cardstack/runtime-common';

async function cardApi(): Promise<
  typeof import('https://cardstack.com/base/card-api')
> {
  return await Loader.import(`${baseRealm.url}card-api`);
}

export async function renderComponent(C: ComponentLike) {
  await render(precompileTemplate(`<C/>`, { scope: () => ({ C }) }));
}

export async function renderCard(
  card: Card,
  format: Format
): Promise<DocumentFragment> {
  let api = await cardApi();
  await api.recompute(card);
  await renderComponent(api.getComponent(card, format));
  return (getContext() as { element: Element }).element.children[0]!
    .shadowRoot!;
}
