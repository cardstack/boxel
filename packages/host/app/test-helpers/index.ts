// @ts-ignore
import { precompileTemplate } from '@ember/template-compilation';
import { getContext, render, settled } from '@ember/test-helpers';

import { provide as provideConsumeContext } from 'ember-provide-consume-context/test-support';

import {
  CardContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import { getCard } from '../resources/card-resource';
import { getCardCollection } from '../resources/card-collection';
import PrerenderedCardSearch from '../components/prerendered-card-search';

import type LoaderService from '../services/loader-service';
import type StoreService from '../services/store';

function getOwnerServices() {
  let context = getContext() as any;
  let owner = context?.owner;
  if (!owner) throw new Error('No test context owner — was setContext() called?');
  let loaderService = owner.lookup('service:loader-service') as LoaderService;
  let commandService = owner.lookup('service:command-service') as any;
  let store = owner.lookup('service:store') as StoreService;
  let router = owner.lookup('service:router') as any;
  let network = owner.lookup('service:network') as any;
  return { loaderService, commandService, store, router, network };
}

type SetupHooks = {
  beforeEach: (fn: () => Promise<void> | void) => void;
  afterEach: (fn: () => Promise<void> | void) => void;
};

export function setupTestRealm(
  hooks: SetupHooks,
  {
    contents,
    realmURL,
  }: { contents: Record<string, object>; realmURL?: string },
) {
  let handler: ((req: Request) => Promise<Response | null>) | null = null;

  hooks.beforeEach(async () => {
    // Resolve the realm URL at test-run time so we can fall back to the live
    // default writable realm when no explicit URL is provided.  This way the
    // in-memory handler intercepts the same URL the component would save to,
    // without needing a targetRealmUrl field on the card.
    let resolvedURL = realmURL ?? getDefaultWritableRealmURL();
    if (!resolvedURL.endsWith('/')) resolvedURL += '/';

    let store = new Map<string, object>();
    for (let [path, data] of Object.entries(contents)) {
      let key = new URL(path, resolvedURL).href;
      store.set(key, data);
    }

    handler = async (req: Request) => {
      if (!req.url.startsWith(resolvedURL)) return null;
      let url = req.url.split('?')[0];

      if (req.method === 'GET' || req.method === 'HEAD') {
        let data = store.get(url) ?? store.get(url + '.json');
        if (!data) return null;
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/vnd.card+json' },
        });
      }

      if (req.method === 'POST') {
        let body = await req.json();
        let typeName = body?.data?.meta?.adoptsFrom?.name ?? 'Card';
        let id = `${resolvedURL}${typeName}/${crypto.randomUUID()}`;
        let doc = { ...body, data: { ...body.data, id } };
        store.set(id, doc);
        return new Response(JSON.stringify(doc), {
          status: 201,
          headers: { 'Content-Type': 'application/vnd.card+json' },
        });
      }

      if (req.method === 'PATCH') {
        let body = await req.json();
        let doc = { ...body, data: { ...body.data, id: url } };
        store.set(url, doc);
        return new Response(JSON.stringify(doc), {
          headers: { 'Content-Type': 'application/vnd.card+json' },
        });
      }

      if (req.method === 'DELETE') {
        store.delete(url);
        return new Response(null, { status: 204 });
      }

      return null;
    };

    (getContext() as any).__testRealmURL = resolvedURL;
    let { network } = getOwnerServices();
    network.virtualNetwork.mount(handler, { prepend: true });
  });

  hooks.afterEach(async () => {
    await settled();
    (getContext() as any).__testRealmURL = null;
    if (handler) {
      let { network } = getOwnerServices();
      network.virtualNetwork.unmount(handler);
      handler = null;
    }
  });
}

export function getDefaultWritableRealmURL(): string {
  let testRealmURL = (getContext() as any)?.__testRealmURL;
  if (testRealmURL) return testRealmURL;

  let { store } = getOwnerServices();
  // Access allRealmsInfo directly to avoid going through defaultWritableRealm,
  // which calls matrixService.userName → matrixService.client and throws if the
  // matrix SDK hasn't finished loading yet.
  let allRealmsInfo: Record<string, { canWrite: boolean; info: { name: string } }> =
    (store as any).realm?.allRealmsInfo ?? {};
  let writable = Object.entries(allRealmsInfo)
    .filter(([, meta]) => meta.canWrite)
    .sort(([, a], [, b]) => a.info.name.localeCompare(b.info.name));
  let first = writable[0];
  if (!first) throw new Error('No default writable realm found');
  return first[0];
}

export async function fetchCard(url: string): Promise<any> {
  let { loaderService } = getOwnerServices();
  let response = await loaderService.loader.fetch(url, {
    headers: { Accept: 'application/vnd.card+json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch card ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function renderCard(
  card: any,
  opts?: { commandContext?: any; format?: string },
) {
  let { loaderService, commandService, store } = getOwnerServices();
  let api = await loaderService.loader.import('https://cardstack.com/base/card-api');
  let Component = api.getComponent(card);
  let format = opts?.format ?? 'isolated';
  let resolvedCommandContext = opts?.commandContext ?? commandService.commandContext;

  provideConsumeContext(CardContextName, {
    commandContext: resolvedCommandContext,
    getCard,
    getCards: store.getSearchResource.bind(store),
    getCardCollection,
    store,
    prerenderedCardSearchComponent: PrerenderedCardSearch,
    mode: 'operator',
    submode: 'interact',
  });
  provideConsumeContext(GetCardContextName, getCard);
  provideConsumeContext(GetCardsContextName, store.getSearchResource.bind(store));
  provideConsumeContext(GetCardCollectionContextName, getCardCollection);

  let context = { commandContext: resolvedCommandContext };
  await render(
    precompileTemplate('<Component @format={{format}} @context={{context}} />', {
      strictMode: true,
      scope: () => ({ Component, format, context }),
    }),
  );
  await settled();
}

export async function visitOperatorMode(
  state: {
    stacks?: Array<Array<{ id: string; format?: string }>>;
    submode?: string;
    [key: string]: unknown;
  } = {},
) {
  let { router } = getOwnerServices();
  let operatorModeState = {
    stacks: state.stacks ?? [],
    submode: state.submode ?? 'interact',
    workspaceChooserOpened: false,
    aiAssistantOpen: false,
    ...state,
  };
  await router.transitionTo('index', {
    queryParams: { operatorModeState: JSON.stringify(operatorModeState) },
  });
  await settled();
}
