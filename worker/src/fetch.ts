import { CardError, badRequest } from '@cardstack/runtime-common/error';
import { generateExternalStub } from '@cardstack/runtime-common/externals';
import {
  Realm,
  baseRealm,
  ResourceObjectWithId,
  CardRef,
} from '@cardstack/runtime-common';
import { parse, stringify } from 'qs';
import { isCardRef } from '@cardstack/runtime-common/search-index';
import { getExternalCardDefinition } from '@cardstack/runtime-common/search-index';

export class FetchHandler {
  private realm: Realm | undefined;

  constructor(private livenessWatcher?: { alive: boolean }) {}

  addRealm(realm: Realm) {
    this.realm = realm;
  }

  async handleFetch(request: Request): Promise<Response> {
    try {
      if (this.livenessWatcher && !this.livenessWatcher.alive) {
        // if we're shutting down, let all requests pass through unchanged
        return await fetch(request);
      }

      let searchParams = new URL(request.url).searchParams;
      if (searchParams.get('dropcache') != null) {
        return await this.dropCaches();
      }

      let url = new URL(request.url);
      // chop off the query string from the URL so we can look at the route specifically
      url = new URL(url.pathname, url);

      // TODO Create a BaseRealm that extends Realm that handles all the
      // requests for the base realm -- this can be scaffolding for now, but it
      // should exercise the Realm API
      if (baseRealm.inRealm(url)) {
        if (
          request.headers.get('Accept')?.includes('application/vnd.api+json') &&
          baseRealm.local(url) === '_typeOf'
        ) {
          return scaffoldBaseRealmTypeOf(request);
        }
        // TODO we shouldn't need to generate an external stub for base cards since these will be served from a real server
        return generateExternalStub(
          url.pathname.replace('/base/', 'runtime-spike/lib/')
        );
      }
      if (!this.realm) {
        console.warn(`No realm is currently available`);
      } else if (url.href.includes(this.realm.url)) {
        return await this.realm.handle(request);
      }
      if (url.origin === 'http://externals') {
        return generateExternalStub(url.pathname.slice(1));
      }

      console.log(`Service worker passing through ${request.url}`);
      return await fetch(request);
    } catch (err) {
      if (err instanceof CardError) {
        return err.response;
      }
      console.error(err);
      return new Response(`unexpected exception in service worker ${err}`, {
        status: 500,
      });
    }
  }

  async dropCaches() {
    let names = await globalThis.caches.keys();
    for (let name of names) {
      await self.caches.delete(name);
    }
    return new Response(`Caches dropped!`, {
      headers: {
        'content-type': 'text/html',
      },
    });
  }
}

// TODO perhaps instead of this we can have the search index just index the base
// card source code and just serve our the card definitions from the search
// index? (this is just copy pasted from the Realm code, which seems like a
// smell)
async function scaffoldBaseRealmTypeOf(request: Request): Promise<Response> {
  let ref = parse(new URL(request.url).search, { ignoreQueryPrefix: true });
  if (!isCardRef(ref)) {
    return badRequest('a valid card reference was not specified');
  }

  if (ref.type !== 'exportedCard') {
    throw new Error(
      `Don't know how to construct scaffolded card type for ${JSON.stringify(
        ref
      )}`
    );
  }

  let def = await getExternalCardDefinition(new URL(ref.module), ref.name);
  if (!def) {
    throw new Error(
      `Don't know how to construct scaffolded card type for ${JSON.stringify(
        ref
      )}`
    );
  }
  let data: ResourceObjectWithId = {
    id: def.key,
    type: 'card-definition',
    relationships: {},
  };
  if (!data.relationships) {
    throw new Error('bug: this should never happen');
  }

  if (def.super) {
    data.relationships._super = {
      links: {
        related: baseRealmTypeURL(def.super),
      },
      meta: {
        type: 'super',
      },
    };
  }
  for (let [fieldName, field] of def.fields) {
    data.relationships[fieldName] = {
      links: {
        related: baseRealmTypeURL(field.fieldCard),
      },
      meta: {
        type: field.fieldType,
      },
    };
  }
  return new Response(JSON.stringify({ data }, null, 2), {
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

function baseRealmTypeURL(ref: CardRef): string {
  if (ref.type !== 'exportedCard') {
    throw new Error(
      `Don't know how to construct scaffolded card type for ${JSON.stringify(
        ref
      )}`
    );
  }
  if (baseRealm.inRealm(new URL(ref.module))) {
    return `${baseRealm.fileURL('_typeOf')}?${stringify(ref)}`;
  }

  throw new Error(
    `Don't know how to resolve realm URL for module ${ref.module}`
  );
}
