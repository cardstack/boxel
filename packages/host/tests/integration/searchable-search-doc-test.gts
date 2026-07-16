import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  rri,
  type Realm,
  type IndexedInstance,
  type SearchDocTimings,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardStoreWithGarbageCollection from '@cardstack/host/lib/gc-card-store';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  setupBaseRealm,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  CardDef,
  FieldDef,
  Component,
  StringField,
  createFromSerialized,
  getDataBucket,
  searchDocFromFields,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

let loader: Loader;
let realm: Realm;

// Exercises the searchable-driven generator `searchDocFromFields`.
//
// Central property: search-doc depth is sourced ONLY from the `searchable`
// annotations on the card being indexed — a card pulled in as a link target
// does NOT re-consult its own `searchable`; only the route declared on the
// indexed card continues into it.
module('Integration | searchable search doc', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  hooks.beforeEach(async function () {
    // ---- leaf link targets -------------------------------------------------
    class Agent extends CardDef {
      static displayName = 'Agent';
      @field name = contains(StringField);
    }
    class Headquarters extends CardDef {
      static displayName = 'Headquarters';
      @field name = contains(StringField);
    }
    // A link target two hops deep with TWO further links, each made searchable
    // on ITSELF — those annotations are dormant whenever Company is pulled in,
    // and only fire when a route from the indexed card names them.
    class Company extends CardDef {
      static displayName = 'Company';
      @field name = contains(StringField);
      @field ceo = linksTo(Agent, { searchable: true });
      @field hq = linksTo(Headquarters, { searchable: true });
    }
    // The shared one-hop target. Its OWN `agent` link is searchable (dormant
    // when Author is pulled in); `company` is unannotated.
    class Author extends CardDef {
      static displayName = 'Author';
      @field name = contains(StringField);
      @field agent = linksTo(Agent, { searchable: true });
      @field company = linksTo(Company);
    }

    // ---- linksTo route shapes (all link to Author/au1) ---------------------
    class ArticleSelf extends CardDef {
      static displayName = 'ArticleSelf';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: true }); // self link only
    }
    class ArticleDeep extends CardDef {
      static displayName = 'ArticleDeep';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: 'agent' }); // 1-hop route
    }
    class ArticleShallow extends CardDef {
      static displayName = 'ArticleShallow';
      @field title = contains(StringField);
      @field author = linksTo(Author); // unannotated → {id}
    }
    class ArticleHop2 extends CardDef {
      static displayName = 'ArticleHop2';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: 'company' }); // 2-hop
    }
    class ArticleHop3 extends CardDef {
      static displayName = 'ArticleHop3';
      @field title = contains(StringField);
      // 3-segment route author.company.hq — the "a.b.c" dotted case.
      @field author = linksTo(Author, { searchable: 'company.hq' });
    }
    class ArticleShared extends CardDef {
      static displayName = 'ArticleShared';
      @field title = contains(StringField);
      // Shared ancestor: both routes pass through `company`, then diverge.
      @field author = linksTo(Author, {
        searchable: ['company.ceo', 'company.hq'],
      });
    }
    class ArticleMulti extends CardDef {
      static displayName = 'ArticleMulti';
      @field title = contains(StringField);
      // Array with divergent heads: one self link + one deep route.
      @field author = linksTo(Author, { searchable: ['agent', 'company.hq'] });
    }
    class ArticleEmptyPath extends CardDef {
      static displayName = 'ArticleEmptyPath';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: '' }); // '' == self link
    }
    // Malformed / impossible searchable values must degrade gracefully, never
    // crash and never emit a junk expansion.
    class ArticleEmptyArray extends CardDef {
      static displayName = 'ArticleEmptyArray';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: [] }); // → no route
    }
    class ArticleNullSearchable extends CardDef {
      static displayName = 'ArticleNullSearchable';
      @field title = contains(StringField);
      @field author = linksTo(Author, { searchable: null as any }); // unannotated
    }
    class ArticleArrayWithNull extends CardDef {
      static displayName = 'ArticleArrayWithNull';
      @field title = contains(StringField);
      // The non-string entry is ignored; the valid route still expands.
      @field author = linksTo(Author, { searchable: ['agent', null] as any });
    }
    class ArticleImpossiblePath extends CardDef {
      static displayName = 'ArticleImpossiblePath';
      @field title = contains(StringField);
      // `agent` is a leaf with no `deeper` field — the unreachable tail is a
      // no-op; the reachable prefix (agent) still expands.
      @field author = linksTo(Author, { searchable: 'agent.deeper' });
    }
    class ArticleFalse extends CardDef {
      static displayName = 'ArticleFalse';
      @field title = contains(StringField);
      // `false` is not a valid searchable value — exercised as bad input.
      @field author = linksTo(Author, { searchable: false as any });
    }

    // ---- cycles ------------------------------------------------------------
    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
      @field friend = linksTo(() => Person, { searchable: true });
    }
    // A ring: the route `next.next.next` walks r1→r2→r3 and clips on re-entry.
    class Ring extends CardDef {
      static displayName = 'Ring';
      @field name = contains(StringField);
      @field next = linksTo(() => Ring, { searchable: 'next.next' });
    }
    // The same, plural: `nexts.nexts.nexts` walks the ring and clips.
    class RingM extends CardDef {
      static displayName = 'RingM';
      @field name = contains(StringField);
      @field nexts = linksToMany(() => RingM, { searchable: 'nexts.nexts' });
    }

    // ---- contained values that hold links (the four combinations) ----------
    // A FieldDef carrying a contained scalar AND both link arities, so a route
    // can pass through it — whether the FieldDef is `contains` or
    // `containsMany` — into either a `linksTo` or a `linksToMany`. The contained
    // scalar (`label`) is always included; an unrouted link inside stays { id }.
    class Crew extends FieldDef {
      static displayName = 'Crew';
      @field label = contains(StringField);
      @field lead = linksTo(Agent);
      @field roster = linksToMany(Agent);
    }
    class ArticleContainsLead extends CardDef {
      static displayName = 'ArticleContainsLead';
      @field title = contains(StringField);
      @field crew = contains(Crew, { searchable: 'lead' }); // contains → linksTo
    }
    class ArticleContainsRoster extends CardDef {
      static displayName = 'ArticleContainsRoster';
      @field title = contains(StringField);
      @field crew = contains(Crew, { searchable: 'roster' }); // contains → linksToMany
    }
    class ArticleManyLead extends CardDef {
      static displayName = 'ArticleManyLead';
      @field title = contains(StringField);
      @field crews = containsMany(Crew, { searchable: 'lead' }); // containsMany → linksTo
    }
    class ArticleManyRoster extends CardDef {
      static displayName = 'ArticleManyRoster';
      @field title = contains(StringField);
      @field crews = containsMany(Crew, { searchable: 'roster' }); // containsMany → linksToMany
    }
    class ArticleLabels extends CardDef {
      static displayName = 'ArticleLabels';
      @field title = contains(StringField);
      @field labels = containsMany(StringField);
    }

    // ---- linksToMany -------------------------------------------------------
    // Plural self-link to Author: members expand, but each member.agent stays
    // {id} (the pulled-in Author's own `searchable` is dormant).
    class Team extends CardDef {
      static displayName = 'Team';
      @field name = contains(StringField);
      @field members = linksToMany(Author, { searchable: true });
    }
    class TeamShallow extends CardDef {
      static displayName = 'TeamShallow';
      @field name = contains(StringField);
      @field members = linksToMany(Agent); // unannotated → [{id}]
    }
    class TeamDeep extends CardDef {
      static displayName = 'TeamDeep';
      @field name = contains(StringField);
      // Deep route into each plural element.
      @field members = linksToMany(Author, { searchable: 'agent' });
    }

    // ---- declared-type enumeration / parity --------------------------------
    class SimpleAuthor extends CardDef {
      static displayName = 'SimpleAuthor';
      @field name = contains(StringField);
    }
    class FancyAuthor extends SimpleAuthor {
      static displayName = 'FancyAuthor';
      @field penName = contains(StringField);
    }
    class ParityArticle extends CardDef {
      static displayName = 'ParityArticle';
      @field title = contains(StringField);
      @field authors = linksToMany(SimpleAuthor, { searchable: true });
      static isolated = class extends Component<typeof this> {
        <template><@fields.authors /></template>
      };
    }
    class ArticleSubtype extends CardDef {
      static displayName = 'ArticleSubtype';
      @field title = contains(StringField);
      @field author = linksTo(SimpleAuthor, { searchable: true });
    }
    class TeamSubtype extends CardDef {
      static displayName = 'TeamSubtype';
      @field title = contains(StringField);
      @field members = linksToMany(SimpleAuthor, { searchable: true });
    }
    // A polymorphic contained value: the instance holds a FancyProfile, but the
    // declared field type is Profile, so the subtype's `tagline` is dropped.
    class Profile extends FieldDef {
      static displayName = 'Profile';
      @field bio = contains(StringField);
    }
    class FancyProfile extends Profile {
      static displayName = 'FancyProfile';
      @field tagline = contains(StringField);
    }
    class ArticleProfile extends CardDef {
      static displayName = 'ArticleProfile';
      @field title = contains(StringField);
      @field profile = contains(Profile); // unannotated — contains is always included
    }

    // ---- query-backed field (must never appear in the doc) -----------------
    class ArticleQuery extends CardDef {
      static displayName = 'ArticleQuery';
      @field title = contains(StringField);
      @field related = linksToMany(() => Agent, {
        searchable: true,
        query: { filter: { eq: { name: 'Agent Smith' } } },
      });
    }

    // ---- a throwing branch beside a searchable link -------------------------
    // On a fresh store the computed's branch throws: reading `other` fires
    // that target's lazy load and yields `undefined`, so the `.name` read
    // throws. The computed is declared BEFORE the searchable link, so a walk
    // that stopped at the first failing branch would never reach the link
    // field. Branches run concurrently and all settle before the first
    // rejection rethrows, so the searchable link's targeted load fires (and
    // completes) in the same walk. Once `other` is resident the computed
    // succeeds, so the card indexes cleanly.
    class Boom extends CardDef {
      static displayName = 'Boom';
      @field other = linksTo(Author);
      @field boom = contains(StringField, {
        computeVia: function (this: any) {
          return this.other.name;
        },
      });
      @field agent = linksTo(Agent, { searchable: true });
    }

    let agentRef = (id: string) => ({ links: { self: id } });

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'agent.gts': { Agent },
        'headquarters.gts': { Headquarters },
        'company.gts': { Company },
        'author.gts': { Author },
        'article.gts': {
          ArticleSelf,
          ArticleDeep,
          ArticleShallow,
          ArticleHop2,
          ArticleHop3,
          ArticleShared,
          ArticleMulti,
          ArticleEmptyPath,
          ArticleEmptyArray,
          ArticleNullSearchable,
          ArticleArrayWithNull,
          ArticleImpossiblePath,
          ArticleFalse,
        },
        'person.gts': { Person },
        'ring.gts': { Ring },
        'ring-m.gts': { RingM },
        'crew.gts': {
          Crew,
          ArticleContainsLead,
          ArticleContainsRoster,
          ArticleManyLead,
          ArticleManyRoster,
          ArticleLabels,
        },
        'team.gts': { Team, TeamShallow, TeamDeep, TeamSubtype },
        'parity.gts': {
          SimpleAuthor,
          FancyAuthor,
          ParityArticle,
          ArticleSubtype,
        },
        'profile.gts': { Profile, FancyProfile, ArticleProfile },
        'article-query.gts': { ArticleQuery },
        'boom.gts': { Boom },

        // --- leaves + chain ---
        'Agent/a1.json': card('Agent Smith', 'agent', 'Agent'),
        'Agent/a2.json': card('Agent Jones', 'agent', 'Agent'),
        // Referenced only by Boom/b1, so its residency in a test's store is
        // attributable to that card's walk alone.
        'Agent/a3.json': card('Agent Braun', 'agent', 'Agent'),
        'Headquarters/h1.json': card('HQ One', 'headquarters', 'Headquarters'),
        'Company/co1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Company/co1`,
            attributes: { name: 'Acme' },
            relationships: {
              ceo: agentRef(`${testRealmURL}Agent/a1`),
              hq: agentRef(`${testRealmURL}Headquarters/h1`),
            },
            meta: adoptsFrom('company', 'Company'),
          },
        },
        'Author/au1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Author/au1`,
            attributes: { name: 'Jo' },
            relationships: {
              agent: agentRef(`${testRealmURL}Agent/a1`),
              company: agentRef(`${testRealmURL}Company/co1`),
            },
            meta: adoptsFrom('author', 'Author'),
          },
        },
        'Author/au2.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Author/au2`,
            attributes: { name: 'Mit' },
            relationships: { agent: agentRef(`${testRealmURL}Agent/a2`) },
            meta: adoptsFrom('author', 'Author'),
          },
        },

        // --- linksTo route shapes (all → Author/au1) ---
        'ArticleSelf/s1.json': article('Self', 'ArticleSelf', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        // Relative `links.self` — must resolve before the targeted load.
        'ArticleSelf/rel.json': article('Relative', 'ArticleSelf', {
          author: agentRef('../Author/au1'),
        }),
        // Points at a card that does not exist (broken / 404 target).
        'ArticleSelf/broken.json': article('Broken', 'ArticleSelf', {
          author: agentRef(`${testRealmURL}Author/ghost`),
        }),
        // author = null (no link at all).
        'ArticleSelf/nulllink.json': article('Null', 'ArticleSelf', {
          author: { links: { self: null } },
        }),
        'ArticleDeep/d1.json': article('Deep', 'ArticleDeep', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleShallow/sh1.json': article('Shallow', 'ArticleShallow', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleHop2/h2.json': article('Hop2', 'ArticleHop2', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleHop3/h3.json': article('Hop3', 'ArticleHop3', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleShared/shr1.json': article('Shared', 'ArticleShared', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleMulti/m1.json': article('Multi', 'ArticleMulti', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleEmptyPath/ep1.json': article('Empty', 'ArticleEmptyPath', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleEmptyArray/ea1.json': article('EArr', 'ArticleEmptyArray', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),
        'ArticleNullSearchable/ns1.json': article(
          'Nul',
          'ArticleNullSearchable',
          { author: agentRef(`${testRealmURL}Author/au1`) },
        ),
        'ArticleArrayWithNull/awn1.json': article(
          'AwN',
          'ArticleArrayWithNull',
          { author: agentRef(`${testRealmURL}Author/au1`) },
        ),
        'ArticleImpossiblePath/ip1.json': article(
          'Imp',
          'ArticleImpossiblePath',
          { author: agentRef(`${testRealmURL}Author/au1`) },
        ),
        'ArticleFalse/f1.json': article('Fls', 'ArticleFalse', {
          author: agentRef(`${testRealmURL}Author/au1`),
        }),

        // --- cycles ---
        'Person/p1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Person/p1`,
            attributes: { name: 'Solo' },
            relationships: {
              friend: agentRef(`${testRealmURL}Person/p1`),
            },
            meta: adoptsFrom('person', 'Person'),
          },
        },
        'Ring/r1.json': ring('R1', `${testRealmURL}Ring/r2`),
        'Ring/r2.json': ring('R2', `${testRealmURL}Ring/r3`),
        'Ring/r3.json': ring('R3', `${testRealmURL}Ring/r1`),
        'RingM/rm1.json': ringM('R1m', `${testRealmURL}RingM/rm2`),
        'RingM/rm2.json': ringM('R2m', `${testRealmURL}RingM/rm3`),
        'RingM/rm3.json': ringM('R3m', `${testRealmURL}RingM/rm1`),

        // --- contained values holding links (4 combinations) ---
        // A single contained Crew: label + lead(linksTo) + roster(linksToMany).
        'ArticleContainsLead/cl1.json': {
          data: {
            type: 'card',
            attributes: { title: 'CL', crew: { label: 'Alpha' } },
            relationships: {
              'crew.lead': agentRef(`${testRealmURL}Agent/a1`),
              'crew.roster.0': agentRef(`${testRealmURL}Agent/a1`),
              'crew.roster.1': agentRef(`${testRealmURL}Agent/a2`),
            },
            meta: adoptsFrom('crew', 'ArticleContainsLead'),
          },
        },
        'ArticleContainsRoster/cr1.json': {
          data: {
            type: 'card',
            attributes: { title: 'CR', crew: { label: 'Alpha' } },
            relationships: {
              'crew.lead': agentRef(`${testRealmURL}Agent/a1`),
              'crew.roster.0': agentRef(`${testRealmURL}Agent/a1`),
              'crew.roster.1': agentRef(`${testRealmURL}Agent/a2`),
            },
            meta: adoptsFrom('crew', 'ArticleContainsRoster'),
          },
        },
        // Two contained Crews, each with its own label + lead + roster.
        'ArticleManyLead/ml1.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'ML',
              crews: [{ label: 'C0' }, { label: 'C1' }],
            },
            relationships: {
              'crews.0.lead': agentRef(`${testRealmURL}Agent/a1`),
              'crews.0.roster.0': agentRef(`${testRealmURL}Agent/a1`),
              'crews.1.lead': agentRef(`${testRealmURL}Agent/a2`),
              'crews.1.roster.0': agentRef(`${testRealmURL}Agent/a2`),
            },
            meta: adoptsFrom('crew', 'ArticleManyLead'),
          },
        },
        'ArticleManyRoster/mr1.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'MR',
              crews: [{ label: 'C0' }, { label: 'C1' }],
            },
            relationships: {
              'crews.0.lead': agentRef(`${testRealmURL}Agent/a1`),
              'crews.0.roster.0': agentRef(`${testRealmURL}Agent/a1`),
              'crews.1.lead': agentRef(`${testRealmURL}Agent/a2`),
              'crews.1.roster.0': agentRef(`${testRealmURL}Agent/a2`),
            },
            meta: adoptsFrom('crew', 'ArticleManyRoster'),
          },
        },
        // --- containsMany of primitives ---
        'ArticleLabels/l1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleLabels/l1`,
            attributes: { title: 'Labels', labels: ['red', 'blue'] },
            meta: adoptsFrom('crew', 'ArticleLabels'),
          },
        },
        'ArticleLabels/empty1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleLabels/empty1`,
            attributes: { title: 'Empty', labels: [] },
            meta: adoptsFrom('crew', 'ArticleLabels'),
          },
        },

        // --- linksToMany ---
        'Team/valid.json': team('Valid', 'Team', [
          `${testRealmURL}Author/au1`,
          `${testRealmURL}Author/au2`,
        ]),
        'Team/missone.json': team('MissOne', 'Team', [
          `${testRealmURL}Author/au1`,
          `${testRealmURL}Author/ghost1`,
        ]),
        'Team/missall.json': team('MissAll', 'Team', [
          `${testRealmURL}Author/ghost1`,
          `${testRealmURL}Author/ghost2`,
        ]),
        'Team/empty.json': team('EmptyTeam', 'Team', []),
        'TeamShallow/ts1.json': team('Shallow', 'TeamShallow', [
          `${testRealmURL}Agent/a1`,
        ]),
        'TeamDeep/td1.json': team('Deep', 'TeamDeep', [
          `${testRealmURL}Author/au1`,
        ]),

        // --- declared type / parity ---
        'SimpleAuthor/sa1.json': card('Plain', 'parity', 'SimpleAuthor'),
        'FancyAuthor/fa1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}FancyAuthor/fa1`,
            attributes: { name: 'Fancy', penName: 'Quill' },
            meta: adoptsFrom('parity', 'FancyAuthor'),
          },
        },
        'ParityArticle/pa1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ParityArticle/pa1`,
            attributes: { title: 'Parity' },
            relationships: {
              'authors.0': agentRef(`${testRealmURL}SimpleAuthor/sa1`),
            },
            meta: adoptsFrom('parity', 'ParityArticle'),
          },
        },
        'ArticleSubtype/sub1.json': {
          data: {
            type: 'card',
            attributes: { title: 'Subtype' },
            relationships: {
              author: agentRef(`${testRealmURL}FancyAuthor/fa1`),
            },
            meta: adoptsFrom('parity', 'ArticleSubtype'),
          },
        },
        'TeamSubtype/tsub1.json': team('SubtypeTeam', 'TeamSubtype', [
          `${testRealmURL}FancyAuthor/fa1`,
        ]),
        'ArticleProfile/prof1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleProfile/prof1`,
            attributes: {
              title: 'Profile',
              profile: { bio: 'a bio', tagline: 'a tagline' },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}profile`,
                name: 'ArticleProfile',
              },
              fields: {
                profile: {
                  adoptsFrom: {
                    module: `${testRealmURL}profile`,
                    name: 'FancyProfile',
                  },
                },
              },
            },
          },
        },

        // --- query-backed field ---
        'ArticleQuery/q1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ArticleQuery/q1`,
            attributes: { title: 'Query' },
            meta: adoptsFrom('article-query', 'ArticleQuery'),
          },
        },

        // --- throwing branch beside a searchable link ---
        'Boom/b1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Boom/b1`,
            attributes: {},
            relationships: {
              other: agentRef(`${testRealmURL}Author/au1`),
              agent: agentRef(`${testRealmURL}Agent/a3`),
            },
            meta: adoptsFrom('boom', 'Boom'),
          },
        },
      },
    }));
  });

  // --- fixture builders -----------------------------------------------------
  function adoptsFrom(mod: string, name: string) {
    return { adoptsFrom: { module: `${testRealmURL}${mod}`, name } };
  }
  function card(name: string, mod: string, klass: string) {
    return {
      data: {
        type: 'card',
        attributes: { name },
        meta: adoptsFrom(mod, klass),
      },
    };
  }
  function article(title: string, klass: string, relationships: any) {
    return {
      data: {
        type: 'card',
        attributes: { title },
        relationships,
        meta: adoptsFrom('article', klass),
      },
    };
  }
  function ring(name: string, next: string) {
    return {
      data: {
        type: 'card',
        attributes: { name },
        relationships: { next: { links: { self: next } } },
        meta: adoptsFrom('ring', 'Ring'),
      },
    };
  }
  function ringM(name: string, next: string) {
    return {
      data: {
        type: 'card',
        attributes: { name },
        relationships: { 'nexts.0': { links: { self: next } } },
        meta: adoptsFrom('ring-m', 'RingM'),
      },
    };
  }
  function team(name: string, klass: string, members: string[]) {
    let relationships: any = {};
    members.forEach((m, i) => {
      relationships[`members.${i}`] = { links: { self: m } };
    });
    return {
      data: {
        type: 'card',
        attributes: { name },
        relationships,
        meta: adoptsFrom('team', klass),
      },
    };
  }

  async function loadAndGenerate(id: string) {
    let store = getService('store') as StoreService;
    let instance = (await store.get(id)) as CardDefType;
    return await searchDocFromFields(instance);
  }

  // The search doc the indexer persisted, minus the synthetic keys `_cardType`
  // and `_title` (which the prerender meta route appends, not the generator).
  // The prerender meta route generates the rest via `searchDocFromFields`; the
  // parity check below confirms it matches a direct `searchDocFromFields` call.
  async function indexedSearchDoc(id: string) {
    let entry = await realm.realmIndexQueryEngine.instance(new URL(id));
    if (!entry || entry.type === 'instance-error') {
      return undefined;
    }
    let { _cardType, _title, ...rest } =
      (entry as IndexedInstance).searchDoc ?? {};
    return rest;
  }

  let agentUrl = `${testRealmURL}Agent/a1`;
  let agent2Url = `${testRealmURL}Agent/a2`;
  let authorUrl = `${testRealmURL}Author/au1`;
  let hqUrl = `${testRealmURL}Headquarters/h1`;

  // ===========================================================================
  // Route seeding: the searchable forms and where depth comes from
  // ===========================================================================

  test('routes come ONLY from the indexed card: a pulled-in target does not consult its own searchable', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/s1`);
    assert.strictEqual(doc.author?.name, 'Jo', 'author is expanded');
    assert.deepEqual(
      doc.author?.agent,
      { id: agentUrl },
      "the pulled-in Author's own searchable agent link stays { id }",
    );
  });

  test('the same card indexed directly DOES honor its own searchable', async function (assert) {
    let doc = await loadAndGenerate(authorUrl);
    assert.strictEqual(
      doc.agent?.name,
      'Agent Smith',
      'Author.agent expands when Author is the card being indexed',
    );
  });

  test('a single dotted route on the indexed card expands the deeper link', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleDeep/d1`);
    assert.strictEqual(
      doc.author?.agent?.name,
      'Agent Smith',
      'the route `author.agent` drives the depth',
    );
  });

  test('an unannotated link stays { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleShallow/sh1`);
    assert.deepEqual(doc.author, { id: authorUrl }, 'captured as { id } only');
  });

  test("an empty-string path ('') behaves as a self link", async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleEmptyPath/ep1`);
    assert.strictEqual(doc.author?.name, 'Jo', 'author is expanded');
    assert.deepEqual(
      doc.author?.agent,
      { id: agentUrl },
      'no deeper than the self link',
    );
  });

  // --- malformed / impossible searchable values (must degrade, never crash) --

  test('an empty searchable array leaves the link as { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleEmptyArray/ea1`);
    assert.deepEqual(doc.author, { id: authorUrl }, 'no route → { id }');
  });

  test('a null searchable annotation is treated as unannotated', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleNullSearchable/ns1`);
    assert.deepEqual(doc.author, { id: authorUrl }, 'null → { id }');
  });

  test('a `false` searchable value (bad input) leaves the link as { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleFalse/f1`);
    assert.deepEqual(doc.author, { id: authorUrl }, 'false → { id }');
  });

  test('a searchable array with a non-string entry ignores it and still expands the valid route', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleArrayWithNull/awn1`);
    assert.strictEqual(doc.title, 'AwN', 'did not crash');
    assert.strictEqual(
      doc.author?.agent?.name,
      'Agent Smith',
      'the valid `agent` route still expands',
    );
  });

  test('a searchable path naming a non-existent field expands the reachable prefix only', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleImpossiblePath/ip1`);
    assert.strictEqual(
      doc.author?.agent?.name,
      'Agent Smith',
      'the reachable prefix (agent) expands',
    );
    assert.notOk(
      'deeper' in (doc.author?.agent ?? {}),
      'the unreachable tail is a no-op (no junk key)',
    );
  });

  // ===========================================================================
  // Multi-segment depth and the "dormant when pulled in" rule at depth
  // ===========================================================================

  test('a two-hop route expands the intermediate but leaves its further links { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleHop2/h2`);
    assert.strictEqual(
      doc.author?.company?.name,
      'Acme',
      'company is expanded',
    );
    assert.deepEqual(
      doc.author?.company?.ceo,
      { id: agentUrl },
      "the pulled-in Company's own searchable ceo stays { id } at depth 2",
    );
    assert.deepEqual(
      doc.author?.company?.hq,
      { id: hqUrl },
      "the pulled-in Company's own searchable hq stays { id } at depth 2",
    );
  });

  test('a three-segment route (a.b.c) expands all the way down', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleHop3/h3`);
    assert.strictEqual(
      doc.author?.company?.hq?.name,
      'HQ One',
      'the route `author.company.hq` expands the third hop',
    );
    assert.deepEqual(
      doc.author?.company?.ceo,
      { id: agentUrl },
      'a sibling of the routed link (ceo) stays { id }',
    );
  });

  test('an array of routes sharing an ancestor collapses through that ancestor once', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleShared/shr1`);
    assert.strictEqual(
      doc.author?.company?.name,
      'Acme',
      'the shared ancestor `company` is expanded',
    );
    assert.strictEqual(
      doc.author?.company?.ceo?.name,
      'Agent Smith',
      'the first divergent route (company.ceo) expands',
    );
    assert.strictEqual(
      doc.author?.company?.hq?.name,
      'HQ One',
      'the second divergent route (company.hq) expands under the same ancestor',
    );
  });

  test('an array of routes with divergent heads expands each independently', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleMulti/m1`);
    assert.strictEqual(
      doc.author?.agent?.name,
      'Agent Smith',
      'the self-link route (agent) expands',
    );
    assert.strictEqual(
      doc.author?.company?.hq?.name,
      'HQ One',
      'the deep route (company.hq) expands',
    );
    assert.deepEqual(
      doc.author?.company?.ceo,
      { id: agentUrl },
      'an unrouted sibling (company.ceo) stays { id }',
    );
  });

  // ===========================================================================
  // linksTo value states
  // ===========================================================================

  test('a relative link reference is resolved before the targeted load', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/rel`);
    assert.strictEqual(
      doc.author?.name,
      'Jo',
      'a relative links.self resolves',
    );
  });

  test('a searchable link to a missing target degrades to { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/broken`);
    assert.deepEqual(
      doc.author,
      { id: `${testRealmURL}Author/ghost` },
      'an unloadable link keeps its reference as { id }',
    );
  });

  test('a null link is captured as null', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSelf/nulllink`);
    assert.strictEqual(doc.author, null, 'a missing link slot is null');
  });

  // ===========================================================================
  // contains / containsMany — routing through a FieldDef into its links.
  // All four combinations (contains|containsMany × linksTo|linksToMany), with
  // the contained scalar ALWAYS present and any unrouted link inside kept as
  // { id }.
  // ===========================================================================

  test('contains → linksTo: routed link expands; contained scalar + unrouted plural still present', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleContainsLead/cl1`);
    assert.strictEqual(
      doc.crew?.label,
      'Alpha',
      'the contained scalar is always included',
    );
    assert.strictEqual(
      doc.crew?.lead?.name,
      'Agent Smith',
      'the routed linksTo expands (target contained field present)',
    );
    assert.deepEqual(
      doc.crew?.roster,
      [{ id: agentUrl }, { id: agent2Url }],
      'the unrouted linksToMany inside is still present as [{ id }]',
    );
  });

  test('contains → linksToMany: routed plural expands; unrouted linksTo stays { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleContainsRoster/cr1`);
    assert.strictEqual(
      doc.crew?.label,
      'Alpha',
      'the contained scalar is always included',
    );
    assert.deepEqual(
      (doc.crew?.roster ?? []).map((m: any) => m.name),
      ['Agent Smith', 'Agent Jones'],
      'the routed linksToMany expands every element',
    );
    assert.deepEqual(
      doc.crew?.lead,
      { id: agentUrl },
      'the unrouted linksTo inside stays { id }',
    );
  });

  test('containsMany → linksTo: each element routes its link; each element scalar present', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleManyLead/ml1`);
    assert.deepEqual(
      (doc.crews ?? []).map((c: any) => c.label),
      ['C0', 'C1'],
      'every element scalar is always included',
    );
    assert.strictEqual(
      doc.crews?.[0]?.lead?.name,
      'Agent Smith',
      "the first element's link expands",
    );
    assert.strictEqual(
      doc.crews?.[1]?.lead?.name,
      'Agent Jones',
      "the second element's link expands",
    );
    assert.deepEqual(
      doc.crews?.[0]?.roster,
      [{ id: agentUrl }],
      'the unrouted plural in the element is [{ id }]',
    );
  });

  test('containsMany → linksToMany: each element routes its plural', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleManyRoster/mr1`);
    assert.strictEqual(
      doc.crews?.[0]?.roster?.[0]?.name,
      'Agent Smith',
      "the first element's plural expands",
    );
    assert.strictEqual(
      doc.crews?.[1]?.roster?.[0]?.name,
      'Agent Jones',
      "the second element's plural expands",
    );
    assert.deepEqual(
      doc.crews?.[0]?.lead,
      { id: agentUrl },
      'the unrouted linksTo in the element stays { id }',
    );
    assert.strictEqual(
      doc.crews?.[0]?.label,
      'C0',
      'the element scalar is present',
    );
  });

  test('a contained value is enumerated by its DECLARED type (subtype field dropped)', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleProfile/prof1`);
    assert.strictEqual(
      doc.profile?.bio,
      'a bio',
      'the declared contained field is present (unannotated contains is always included)',
    );
    assert.notOk(
      'tagline' in (doc.profile ?? {}),
      'the polymorphic subtype-only field is dropped',
    );
  });

  test('containsMany of primitives is captured as an array', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleLabels/l1`);
    assert.deepEqual(
      doc.labels,
      ['red', 'blue'],
      'all primitive items captured',
    );
  });

  test('an empty containsMany is null', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleLabels/empty1`);
    assert.strictEqual(doc.labels, null, 'empty containsMany is null');
  });

  test('contained scalar fields are always present regardless of searchable', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleShallow/sh1`);
    assert.strictEqual(
      doc.title,
      'Shallow',
      'the unrouted contained scalar is present',
    );
    assert.deepEqual(
      doc.author,
      { id: authorUrl },
      'while the unannotated link stays { id }',
    );
  });

  // ===========================================================================
  // linksToMany
  // ===========================================================================

  test('a searchable linksToMany expands every element', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Team/valid`);
    assert.deepEqual(
      (doc.members ?? []).map((m: any) => m.name),
      ['Jo', 'Mit'],
      'both members are expanded in slot order',
    );
  });

  test('linksToMany targets do NOT consult their own searchable', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Team/valid`);
    assert.deepEqual(
      doc.members?.[0]?.agent,
      { id: agentUrl },
      "the pulled-in member's own searchable agent link stays { id }",
    );
  });

  test('an unannotated linksToMany is an array of { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}TeamShallow/ts1`);
    assert.deepEqual(
      doc.members,
      [{ id: agentUrl }],
      'each slot is { id } only',
    );
  });

  test('a deep route into a linksToMany expands each element along it', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}TeamDeep/td1`);
    assert.strictEqual(
      doc.members?.[0]?.agent?.name,
      'Agent Smith',
      'the route `members.agent` drives the depth into each element',
    );
  });

  test('a linksToMany with one missing slot expands the rest and keeps the missing one as { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Team/missone`);
    assert.strictEqual(
      doc.members?.[0]?.name,
      'Jo',
      'the present member expands',
    );
    assert.deepEqual(
      doc.members?.[1],
      { id: `${testRealmURL}Author/ghost1` },
      'the missing member is { id }',
    );
  });

  test('a linksToMany with all slots missing is an array of { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Team/missall`);
    assert.deepEqual(
      doc.members,
      [
        { id: `${testRealmURL}Author/ghost1` },
        { id: `${testRealmURL}Author/ghost2` },
      ],
      'every missing slot keeps its reference as { id }',
    );
  });

  test('an empty linksToMany is null', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Team/empty`);
    assert.strictEqual(doc.members, null, 'empty linksToMany is null');
  });

  // ===========================================================================
  // cycles
  // ===========================================================================

  test('a self-referential link clips the cycle to { id }', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Person/p1`);
    assert.deepEqual(
      doc.friend,
      { id: `${testRealmURL}Person/p1` },
      'a self link clips to { id }',
    );
  });

  test('a three-card ring (linksTo) walks the ring then clips on re-entry', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}Ring/r1`);
    assert.strictEqual(doc.next?.name, 'R2', 'first hop');
    assert.strictEqual(doc.next?.next?.name, 'R3', 'second hop');
    assert.deepEqual(
      doc.next?.next?.next,
      { id: `${testRealmURL}Ring/r1` },
      'the fourth hop re-enters r1 and clips to { id }',
    );
  });

  test('a three-card ring (linksToMany) walks the ring then clips on re-entry', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}RingM/rm1`);
    assert.strictEqual(doc.nexts?.[0]?.name, 'R2m', 'first hop');
    assert.strictEqual(doc.nexts?.[0]?.nexts?.[0]?.name, 'R3m', 'second hop');
    assert.deepEqual(
      doc.nexts?.[0]?.nexts?.[0]?.nexts,
      [{ id: `${testRealmURL}RingM/rm1` }],
      'the fourth hop re-enters rm1 and clips to { id }',
    );
  });

  // ===========================================================================
  // skips and declared-type enumeration
  // ===========================================================================

  test('a query-backed field never appears in the doc', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleQuery/q1`);
    assert.strictEqual(doc.title, 'Query', 'plain fields are present');
    assert.notOk('related' in doc, 'the query-backed field is skipped');
  });

  test('a throwing branch does not stop sibling link loads in the same walk', async function (assert) {
    // Build the instance from its bare document on a dedicated store, so both
    // of its links start not-loaded — the shape the indexer's walk sees. (The
    // live store's card GET sideloads the whole link graph, which would leave
    // nothing for the walk to load.)
    let network = getService('network');
    let store = new CardStoreWithGarbageCollection(
      new Map(),
      network.fetch,
      network.virtualNetwork,
    );
    let doc = {
      data: {
        id: `${testRealmURL}Boom/b1`,
        type: 'card' as const,
        attributes: {},
        relationships: {
          other: { links: { self: `${testRealmURL}Author/au1` } },
          agent: { links: { self: `${testRealmURL}Agent/a3` } },
        },
        meta: {
          adoptsFrom: { module: rri(`${testRealmURL}boom`), name: 'Boom' },
        },
      },
    };
    let instance = (await createFromSerialized(
      doc.data,
      doc,
      new URL(doc.data.id),
      { store },
    )) as CardDefType;
    let thrown: unknown;
    try {
      await searchDocFromFields(instance);
    } catch (e) {
      thrown = e;
    }
    // The computed branch reads its not-yet-loaded `other` target and throws.
    assert.notStrictEqual(
      thrown,
      undefined,
      'the failing branch rethrows to the caller',
    );
    // Branches settle together before the rethrow, so the searchable link's
    // targeted load — a sibling of the throwing computed — has already
    // completed and registered its target.
    assert.ok(
      store.getCard(`${testRealmURL}Agent/a3`),
      'the sibling searchable target loaded during the same walk',
    );
    // Drain the lazy load the computed's read fired so no fetch outlives the
    // test.
    await store.loaded();
  });

  test('a linksTo target is enumerated by its DECLARED type (subtype bloat dropped)', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}ArticleSubtype/sub1`);
    assert.strictEqual(
      doc.author?.name,
      'Fancy',
      'the declared field is present',
    );
    assert.notOk(
      'penName' in (doc.author ?? {}),
      'the subtype-only field is dropped',
    );
  });

  test('a linksToMany target is enumerated by its DECLARED type (subtype bloat dropped)', async function (assert) {
    let doc = await loadAndGenerate(`${testRealmURL}TeamSubtype/tsub1`);
    assert.strictEqual(
      doc.members?.[0]?.name,
      'Fancy',
      'the declared field is present',
    );
    assert.notOk(
      'penName' in (doc.members?.[0] ?? {}),
      'the subtype-only field is dropped',
    );
  });

  // ===========================================================================
  // the indexer is authoritatively searchable-driven
  // ===========================================================================

  // The prerender meta route generates the search doc via `searchDocFromFields`,
  // so the doc the indexer persists is the searchable-driven output for a card
  // carrying a `searchable` annotation: the `authors` link is expanded (not an
  // `{ id }`), and every card carries its base-card links (`cardTheme`,
  // `cardInfo.cardThumbnail`). Unset contained scalars are absent: the rendered
  // instance the indexer serializes yields `undefined` for them, which JSON
  // serialization into the index drops.
  test('the indexer persists the searchable-driven search doc', async function (assert) {
    let id = `${testRealmURL}ParityArticle/pa1`;
    let indexed = await indexedSearchDoc(id);
    assert.deepEqual(
      indexed,
      {
        authors: [
          {
            cardInfo: { cardThumbnail: null, theme: null },
            cardTheme: null,
            cardTitle: 'Untitled SimpleAuthor',
            id: `${testRealmURL}SimpleAuthor/sa1`,
            name: 'Plain',
          },
        ],
        cardInfo: { cardThumbnail: null, theme: null },
        cardTheme: null,
        cardTitle: 'Untitled ParityArticle',
        id: `${testRealmURL}ParityArticle/pa1`,
        title: 'Parity',
      },
      'the indexer persists the searchable-driven doc',
    );

    // The expanded target's data is in the doc, so it must be recorded as a
    // dependency — otherwise editing the target would not reindex the owner.
    let entry = await realm.realmIndexQueryEngine.instance(new URL(id));
    let deps =
      entry && entry.type !== 'instance-error'
        ? ((entry as IndexedInstance).deps ?? [])
        : [];
    assert.ok(
      deps.some((d) => d.includes('SimpleAuthor/sa1')),
      'the searchable-expanded target is recorded as a dependency',
    );
  });

  // ===========================================================================
  // the timing collector (searchDocFieldsMs / searchDocLinkLoads inputs)
  // ===========================================================================

  async function loadInstance(id: string) {
    let store = getService('store') as StoreService;
    return (await store.get(id)) as CardDefType;
  }

  // A store-resident instance can arrive with its link fields already
  // materialized, in which case the generator has no load to perform (and
  // correctly records none). Reset a link slot to its unloaded wire state so
  // the walk drives the load itself — the state an indexing visit starts
  // from.
  function unloadLink(
    instance: CardDefType,
    fieldName: string,
    reference: string | string[],
  ) {
    getDataBucket(instance).set(
      fieldName,
      Array.isArray(reference)
        ? reference.map((r) => ({ type: 'not-loaded', reference: r }))
        : { type: 'not-loaded', reference },
    );
  }

  test('per-field timings are keyed by dotted path and include expanded link targets; link loads carry path + target', async function (assert) {
    let instance = await loadInstance(`${testRealmURL}ArticleDeep/d1`);
    let author = await loadInstance(authorUrl);
    unloadLink(instance, 'author', authorUrl);
    unloadLink(author, 'agent', agentUrl);
    let timings: SearchDocTimings = { fieldsMs: {}, linkLoads: [] };
    let doc = await searchDocFromFields(instance, undefined, timings);

    let fieldsMs = timings.fieldsMs!;
    for (let path of ['title', 'author', 'author.agent']) {
      assert.strictEqual(
        typeof fieldsMs[path],
        'number',
        `fieldsMs['${path}'] is a number, got: ${fieldsMs[path]}`,
      );
      assert.ok(
        fieldsMs[path] >= 0,
        `fieldsMs['${path}'] is non-negative, got: ${fieldsMs[path]}`,
      );
    }
    assert.ok(
      fieldsMs['author'] >= fieldsMs['author.agent'],
      'a parent field time is inclusive of its nested fields',
    );

    let loads = timings.linkLoads!;
    assert.ok(
      loads.some((l) => l.path === 'author' && l.target === authorUrl),
      `the author load is recorded with its path and target, got: ${JSON.stringify(loads)}`,
    );
    assert.ok(
      loads.some((l) => l.path === 'author.agent' && l.target === agentUrl),
      'the route-expanded deeper load is recorded under its dotted path',
    );
    assert.ok(
      loads.every((l) => typeof l.ms === 'number' && l.ms >= 0),
      'every load entry carries a non-negative ms',
    );

    // Instrumentation must not perturb the doc itself.
    assert.deepEqual(
      doc,
      await searchDocFromFields(instance),
      'the instrumented walk produces the same doc as an uninstrumented one',
    );
  });

  test('a plural field accumulates under one path key and records one load per slot', async function (assert) {
    let instance = await loadInstance(`${testRealmURL}Team/valid`);
    unloadLink(instance, 'members', [
      `${testRealmURL}Author/au1`,
      `${testRealmURL}Author/au2`,
    ]);
    let timings: SearchDocTimings = { fieldsMs: {}, linkLoads: [] };
    await searchDocFromFields(instance, undefined, timings);

    let memberKeys = Object.keys(timings.fieldsMs!).filter(
      (k) => k === 'members' || k.startsWith('members.'),
    );
    assert.ok(
      memberKeys.includes('members'),
      'the plural field has a single accumulated key',
    );
    assert.ok(
      memberKeys.includes('members.name'),
      "the expanded members' fields accumulate under the shared dotted path",
    );

    let memberLoads = timings.linkLoads!.filter((l) => l.path === 'members');
    assert.deepEqual(
      memberLoads.map((l) => l.target).sort(),
      [`${testRealmURL}Author/au1`, `${testRealmURL}Author/au2`],
      'each slot records its own load, distinguished by target',
    );
  });

  test('collector channels are opt-in', async function (assert) {
    let instance = await loadInstance(`${testRealmURL}ArticleSelf/s1`);
    unloadLink(instance, 'author', authorUrl);

    let fieldsOnly: SearchDocTimings = { fieldsMs: {} };
    await searchDocFromFields(instance, undefined, fieldsOnly);
    assert.ok(
      Object.keys(fieldsOnly.fieldsMs!).length > 0,
      'the supplied fields channel is filled',
    );
    assert.strictEqual(
      fieldsOnly.linkLoads,
      undefined,
      'the absent loads channel is not created',
    );

    let loadsOnly: SearchDocTimings = { linkLoads: [] };
    await searchDocFromFields(instance, undefined, loadsOnly);
    assert.ok(
      loadsOnly.linkLoads!.some(
        (l) => l.path === 'author' && l.target === authorUrl,
      ),
      'the supplied loads channel is filled',
    );
    assert.strictEqual(
      loadsOnly.fieldsMs,
      undefined,
      'the absent fields channel is not created',
    );
  });
});
