// @ts-ignore
import { precompileTemplate } from '@ember/template-compilation';
import { render, getContext } from '@ember/test-helpers';

import type { Loader } from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common';

import type {
  BaseDef,
  Format,
  Field,
} from 'https://cardstack.com/base/card-api';

import type { ComponentLike } from '@glint/template';

async function cardApi(
  loader: Loader,
): Promise<typeof import('https://cardstack.com/base/card-api')> {
  return await loader.import(`${baseRealm.url}card-api`);
}

export async function renderComponent(C: ComponentLike, format?: Format) {
  await render(
    precompileTemplate(`<C @format={{format}} />`, {
      strictMode: true,
      scope: () => ({ C, format }),
    }),
  );
}

export async function renderCard(
  loader: Loader,
  card: BaseDef,
  format: Format,
  field?: Field,
) {
  let api = await cardApi(loader);
  await renderComponent(api.getComponent(card, field), format);
  return (getContext() as { element: Element }).element;
}
