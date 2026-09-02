import { expect, test } from './fixtures.ts';
import {
  createRealm,
  createSubscribedUserAndLogin,
  postCardSource,
  postNewCard,
} from '../helpers/index.ts';
import { appURL } from '../support/isolated-realm-server.ts';

const serverIndexUrl = new URL(appURL).origin;

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// One classroom day: fifteen blocks, a day that reduces over them, and a
// planner that reduces over the day. `b06` is the block this test rewrites;
// it starts at 40 minutes, so the day begins at 420 and must reach 450.
const BLOCKS: { activity: string; startMinutes: number; duration: number }[] = [
  { activity: 'Arrival & Unpack', startMinutes: 510, duration: 20 },
  { activity: 'Morning Circle', startMinutes: 530, duration: 25 },
  { activity: 'Math Group', startMinutes: 555, duration: 35 },
  { activity: 'Speech Pull-Out', startMinutes: 555, duration: 30 },
  { activity: 'Snack', startMinutes: 590, duration: 20 },
  { activity: 'Centres', startMinutes: 610, duration: 40 },
  { activity: 'OT / Fine Motor', startMinutes: 615, duration: 30 },
  { activity: 'Gross Motor', startMinutes: 650, duration: 30 },
  { activity: 'Story', startMinutes: 680, duration: 25 },
  { activity: 'Lunch', startMinutes: 705, duration: 45 },
  { activity: 'Recess', startMinutes: 740, duration: 25 },
  { activity: 'Language Group', startMinutes: 765, duration: 30 },
  { activity: 'Centres', startMinutes: 795, duration: 35 },
  { activity: 'Transition', startMinutes: 830, duration: 10 },
  { activity: 'Pack Up & Goodbye', startMinutes: 840, duration: 20 },
];
const REWRITTEN_BLOCK_INDEX = 5; // Centres, 40 -> 70
const REWRITTEN_DURATION = 70;
const INITIAL_TOTAL = BLOCKS.reduce((sum, b) => sum + b.duration, 0); // 420
const REWRITTEN_TOTAL =
  INITIAL_TOTAL - BLOCKS[REWRITTEN_BLOCK_INDEX].duration + REWRITTEN_DURATION; // 450

// Read a card the way every non-rendering consumer does: out of the index.
async function indexedAttribute(
  page: import('@playwright/test').Page,
  realmURL: string,
  cardId: string,
  attribute: string,
): Promise<unknown> {
  return await page.evaluate(
    async ({ realmURL, cardId, attribute }) => {
      let token = JSON.parse(localStorage['boxel-session'])[realmURL];
      let response = await fetch(cardId, {
        headers: {
          accept: 'application/vnd.card+json',
          authorization: token,
        },
        mode: 'cors',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(
          `GET ${cardId} failed with HTTP ${response.status}: ${await response.text()}`,
        );
      }
      let doc = await response.json();
      return doc?.data?.attributes?.[attribute];
    },
    { realmURL, cardId, attribute },
  );
}

test.describe('Rollup over a link — target freshness across indexing jobs', () => {
  test('a rollup is recomputed from the rewritten block, not from the copy a prerender tab already held', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    let { username } = await createSubscribedUserAndLogin(
      page,
      'rollup-freshness',
      serverIndexUrl,
    );
    let realmName = uniqueRealmName('rollup-freshness');
    await createRealm(page, realmName);
    let realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    // Three layers, each reducing over the one below. `LabClassroomDay` and
    // `LabClassroomDaySearchable` differ only in the `searchable` annotation
    // on the link, which is what makes the pair a control: the annotated one
    // expands its targets through a targeted per-URL load, so it reads the
    // realm's files no matter what a tab already holds.
    await postCardSource(
      page,
      realmURL,
      'planner-lab.gts',
      `
        import { CardDef, field, contains, linksToMany, Component } from '@cardstack/base/card-api';
        import NumberField from '@cardstack/base/number';
        import StringField from '@cardstack/base/string';

        function clockTime(minutes: number) {
          let hour = Math.floor(minutes / 60);
          let minute = minutes % 60;
          let suffix = hour >= 12 ? 'PM' : 'AM';
          let hour12 = hour % 12 === 0 ? 12 : hour % 12;
          return hour12 + ':' + String(minute).padStart(2, '0') + ' ' + suffix;
        }

        export class LabDayBlock extends CardDef {
          static displayName = 'Lab Day Block';
          @field activity = contains(StringField);
          @field startMinutes = contains(NumberField);
          @field durationMinutes = contains(NumberField);
          @field endMinutes = contains(NumberField, {
            computeVia: function (this: LabDayBlock) {
              return (this.startMinutes ?? 0) + (this.durationMinutes ?? 0);
            },
          });
          @field cardTitle = contains(StringField, {
            computeVia: function (this: LabDayBlock) {
              return clockTime(this.startMinutes ?? 0) + ' · ' + (this.activity ?? '');
            },
          });
          static isolated = class extends Component<typeof this> {
            <template><span data-test-duration>{{@model.durationMinutes}}</span></template>
          };
          static embedded = class extends Component<typeof this> {
            <template><span data-test-duration>{{@model.durationMinutes}}</span></template>
          };
          static fitted = class extends Component<typeof this> {
            <template><span data-test-duration>{{@model.durationMinutes}}</span></template>
          };
        }

        export class LabClassroomDay extends CardDef {
          static displayName = 'Lab Classroom Day';
          @field roomName = contains(StringField);
          @field dayDate = contains(StringField);
          @field blocks = linksToMany(() => LabDayBlock);
          @field blockCount = contains(NumberField, {
            computeVia: function (this: LabClassroomDay) {
              return (this.blocks ?? []).length;
            },
          });
          @field plannedMinutes = contains(NumberField, {
            computeVia: function (this: LabClassroomDay) {
              return (this.blocks ?? []).reduce(
                (sum, block) => sum + (block?.durationMinutes ?? 0),
                0,
              );
            },
          });
          @field dayLine = contains(StringField, {
            computeVia: function (this: LabClassroomDay) {
              let blocks = this.blocks ?? [];
              if (blocks.length === 0) {
                return 'no blocks';
              }
              let firstStart = Math.min(...blocks.map((b) => b?.startMinutes ?? 0));
              let lastEnd = Math.max(...blocks.map((b) => b?.endMinutes ?? 0));
              return blocks.length + ' blocks · ' + clockTime(firstStart) + ' – ' + clockTime(lastEnd);
            },
          });
          static isolated = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
          static embedded = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
          static fitted = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
        }

        export class LabClassroomDaySearchable extends CardDef {
          static displayName = 'Lab Classroom Day (searchable)';
          @field roomName = contains(StringField);
          @field blocks = linksToMany(() => LabDayBlock, { searchable: true });
          @field plannedMinutes = contains(NumberField, {
            computeVia: function (this: LabClassroomDaySearchable) {
              return (this.blocks ?? []).reduce(
                (sum, block) => sum + (block?.durationMinutes ?? 0),
                0,
              );
            },
          });
          static isolated = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
          static embedded = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
          static fitted = class extends Component<typeof this> {
            <template><span data-test-planned>{{@model.plannedMinutes}}</span></template>
          };
        }

        export class LabDayPlanner extends CardDef {
          static displayName = 'Lab Day Planner';
          @field plannerName = contains(StringField);
          @field days = linksToMany(() => LabClassroomDay);
          @field totalPlannedMinutes = contains(NumberField, {
            computeVia: function (this: LabDayPlanner) {
              return (this.days ?? []).reduce(
                (sum, day) => sum + (day?.plannedMinutes ?? 0),
                0,
              );
            },
          });
          static isolated = class extends Component<typeof this> {
            <template><span data-test-total>{{@model.totalPlannedMinutes}}</span></template>
          };
          static embedded = class extends Component<typeof this> {
            <template><span data-test-total>{{@model.totalPlannedMinutes}}</span></template>
          };
          static fitted = class extends Component<typeof this> {
            <template><span data-test-total>{{@model.totalPlannedMinutes}}</span></template>
          };
        }
      `,
    );

    let blockIds: string[] = [];
    for (let block of BLOCKS) {
      blockIds.push(
        await postNewCard(page, realmURL, {
          data: {
            attributes: {
              activity: block.activity,
              startMinutes: block.startMinutes,
              durationMinutes: block.duration,
            },
            meta: {
              adoptsFrom: {
                module: `${realmURL}planner-lab`,
                name: 'LabDayBlock',
              },
            },
          },
        }),
      );
    }

    let blockRelationships = Object.fromEntries(
      blockIds.map((id, index) => [`blocks.${index}`, { links: { self: id } }]),
    );

    let dayId = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          roomName: 'Classroom 2A · Broadway Stars',
          dayDate: '2026-08-30',
        },
        relationships: blockRelationships,
        meta: {
          adoptsFrom: {
            module: `${realmURL}planner-lab`,
            name: 'LabClassroomDay',
          },
        },
      },
    });
    let searchableDayId = await postNewCard(page, realmURL, {
      data: {
        attributes: { roomName: 'Classroom 2A · Broadway Stars' },
        relationships: blockRelationships,
        meta: {
          adoptsFrom: {
            module: `${realmURL}planner-lab`,
            name: 'LabClassroomDaySearchable',
          },
        },
      },
    });
    let plannerId = await postNewCard(page, realmURL, {
      data: {
        attributes: { plannerName: 'Classroom 2A Day Planner' },
        relationships: { 'days.0': { links: { self: dayId } } },
        meta: {
          adoptsFrom: {
            module: `${realmURL}planner-lab`,
            name: 'LabDayPlanner',
          },
        },
      },
    });

    for (let [label, cardId, attribute] of [
      ['day', dayId, 'plannedMinutes'],
      ['searchable day', searchableDayId, 'plannedMinutes'],
      ['planner', plannerId, 'totalPlannedMinutes'],
    ] as const) {
      await expect
        .poll(
          async () => await indexedAttribute(page, realmURL, cardId, attribute),
          {
            timeout: 180_000,
            message: `${label} starts at the sum of every block`,
          },
        )
        .toBe(INITIAL_TOTAL);
    }

    // Rewrite one block. The write lands in the realm server; a prerender tab
    // that rendered the day for the index holds its own copy of this block and
    // is told nothing about the change. Each owner is invalidated through the
    // dependency its render recorded and re-rendered under a new job — whether
    // it reduces over the new value or the one its tab kept is the question.
    let rewrittenBlockId = blockIds[REWRITTEN_BLOCK_INDEX];
    let rewritten = BLOCKS[REWRITTEN_BLOCK_INDEX];
    await page.evaluate(
      async ({ realmURL, rewrittenBlockId, rewritten, duration }) => {
        let token = JSON.parse(localStorage['boxel-session'])[realmURL];
        let response = await fetch(rewrittenBlockId, {
          method: 'PATCH',
          headers: {
            accept: 'application/vnd.card+json',
            'content-type': 'application/vnd.card+json',
            authorization: token,
          },
          mode: 'cors',
          credentials: 'include',
          body: JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                activity: rewritten.activity,
                startMinutes: rewritten.startMinutes,
                durationMinutes: duration,
              },
              meta: {
                adoptsFrom: {
                  module: `${realmURL}planner-lab`,
                  name: 'LabDayBlock',
                },
              },
            },
          }),
        });
        if (!response.ok) {
          throw new Error(
            `PATCH ${rewrittenBlockId} failed with HTTP ${response.status}: ${await response.text()}`,
          );
        }
      },
      {
        realmURL,
        rewrittenBlockId,
        rewritten,
        duration: REWRITTEN_DURATION,
      },
    );

    await expect
      .poll(
        async () =>
          await indexedAttribute(
            page,
            realmURL,
            rewrittenBlockId,
            'durationMinutes',
          ),
        { timeout: 180_000, message: 'the rewritten block is reindexed' },
      )
      .toBe(REWRITTEN_DURATION);

    // The annotated twin is the control: it reads the realm's files through a
    // targeted load, so it moves regardless of what any tab holds. The day and
    // the planner are the subjects.
    for (let [label, cardId, attribute] of [
      ['searchable day', searchableDayId, 'plannedMinutes'],
      ['day', dayId, 'plannedMinutes'],
      ['planner', plannerId, 'totalPlannedMinutes'],
    ] as const) {
      await expect
        .poll(
          async () => await indexedAttribute(page, realmURL, cardId, attribute),
          {
            timeout: 180_000,
            message: `${label} carries the rewritten block's minutes`,
          },
        )
        .toBe(REWRITTEN_TOTAL);
    }
  });
});
