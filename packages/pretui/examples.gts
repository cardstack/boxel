// Pretui — the EXAMPLES layer: realistic usage galleries worn at the foot
// of every component workbench page, below the knob-driven preview.
//
// Two parts live here:
//   1. The seeded word engine — realm code may not touch Math.random or
//      Date.now, so every demo's content derives from an FNV-1a hash of the
//      component's own name. Same page, same words, every render — but each
//      page draws different names, teas, and amounts from the banks, so the
//      gallery never reads as boilerplate.
//   2. EXAMPLES — per-component example sets (real kit components in
//      realistic compositions, not knob rigs), rendered by ExampleGallery.
//
// The fiction is the tea trade the kit showcase already inhabits: Wuyi
// Origins, curing rooms, cupping panels, spring bookings.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Button } from './controls';
import { InputGroup } from './controls-extras';
import { Avatar, AvatarGroup, Chip, Meter, StatusChip, Token } from './ink';
import { KeyValue, Prose, Stat } from './reading';
import type { KeyValueItem } from './reading';
import { Alert, Toast } from './feedback';

// The seeded word engine, the word banks and the shared example scaffolding
// live in ./examples-kit so per-component example modules can import them
// without a cycle through this barrel. Re-exported here because ten territory
// and demo modules already import them from './examples'.
import {
  AMOUNTS,
  DATES,
  Lab,
  Mono,
  PEOPLE,
  PLACES,
  Row,
  Stack,
  SUPPLIERS,
  TASKS,
  TEAS,
  pick,
  seedFrom,
  slugOf,
  take,
} from './examples-kit';
import { EXAMPLES_BUTTON } from './components/button.examples';
import { EXAMPLES_ICON_BUTTON } from './components/icon-button.examples';
import { EXAMPLES_INPUT } from './components/input.examples';
import { EXAMPLES_SELECT } from './components/select.examples';
import { EXAMPLES_CHECKBOX } from './components/checkbox.examples';
import { EXAMPLES_SWITCH } from './components/switch.examples';
import { EXAMPLES_SLIDER } from './components/slider.examples';
import { EXAMPLES_RATING } from './components/rating.examples';
import { mergeRegistry } from './registry';

// slugOf is intentionally absent: it was private to this module before the
// examples-kit extraction, so re-exporting it here would grow the barrel's
// public surface. Per-component example modules import it from ./examples-kit.
export {
  AMOUNTS,
  DATES,
  PEOPLE,
  PLACES,
  SUPPLIERS,
  TASKS,
  TEAS,
  pick,
  seedFrom,
  take,
};
import type { ExampleSpec } from './examples-kit';
export type { ExampleSpec };

// ── StatusChip ───────────────────────────────────────────────────────────
const STC = seedFrom('StatusChip');
const stcSuppliers = take(STC, 0, 3, SUPPLIERS);
const stcSuppliers0 = stcSuppliers[0];
const stcSuppliers1 = stcSuppliers[1];
const stcSuppliers2 = stcSuppliers[2];

const StatusChipGridColumn: TemplateOnlyComponent = <template>
  <Stack>
    <Row>
      <Lab>{{stcSuppliers0}}</Lab>
      <StatusChip @value='active' />
    </Row>
    <Row>
      <Lab>{{stcSuppliers1}}</Lab>
      <StatusChip @value='review' />
    </Row>
    <Row>
      <Lab>{{stcSuppliers2}}</Lab>
      <StatusChip @value='overdue' />
    </Row>
  </Stack>
</template>;

const StatusChipLifecycle: TemplateOnlyComponent = <template>
  <Row>
    <StatusChip @value='received' />
    <StatusChip @value='curing' />
    <StatusChip @value='cupped' />
    <StatusChip @value='listed' />
  </Row>
</template>;

// ── Chip ─────────────────────────────────────────────────────────────────
const CHI = seedFrom('Chip');
const chiPlace = pick(CHI, 0, PLACES);
const chiTea = pick(CHI, 1, TEAS);
const chiTitleTea = pick(CHI, 2, TEAS);

const ChipTagRail: TemplateOnlyComponent = <template>
  <Row>
    <Chip @label={{chiPlace}} @hue='var(--chart-4)' />
    <Chip @label='organic' @hue='var(--chart-2)' />
    <Chip @label='first flush' @hue='var(--chart-1)' />
  </Row>
</template>;

const ChipDotless: TemplateOnlyComponent = <template>
  <Row>
    <Chip @label='SS26' @dot={{false}} />
    <Chip @label={{chiTea}} @dot={{false}} />
  </Row>
</template>;

const ChipAfterTitle: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{chiTitleTea}}</Lab>
    <Chip @label='new' @hue='var(--chart-2)' />
  </Row>
</template>;

// ── Token ────────────────────────────────────────────────────────────────
const TOK = seedFrom('Token');
const tokLot = 'lot_' + pick(TOK, 0, DATES).replaceAll('-', '').slice(2);
const tokPlaceSlug = slugOf(pick(TOK, 1, PLACES));
const tokDate = pick(TOK, 2, DATES);
const tokSupplierSlug = slugOf(pick(TOK, 3, SUPPLIERS));

const TokenInProse: TemplateOnlyComponent = <template>
  <Prose>
    <p>Batch
      <Token @value={{tokLot}} />
      cleared cupping and ships from
      <Token @value={{tokPlaceSlug}} />
      on
      {{tokDate}}.</p>
  </Prose>
</template>;

const TokenRow: TemplateOnlyComponent = <template>
  <Row>
    <Token @value={{tokSupplierSlug}} />
    <Token @value='v0.4.0' />
    <Token @value='priority' @hue='var(--chart-4)' />
  </Row>
</template>;

// ── Avatar ───────────────────────────────────────────────────────────────
const AVA = seedFrom('Avatar');
const avaAssignee = pick(AVA, 0, PEOPLE);
const avaPanel = take(AVA, 1, 4, PEOPLE);
const avaPanel0 = avaPanel[0];
const avaPanel1 = avaPanel[1];
const avaPanel2 = avaPanel[2];
const avaPanel3 = avaPanel[3];
const avaChair = pick(AVA, 2, PEOPLE);

const AvatarAssignee: TemplateOnlyComponent = <template>
  <Row>
    <Avatar @name={{avaAssignee}} />
    <Lab>{{avaAssignee}}</Lab>
    <Mono>sourcing</Mono>
  </Row>
</template>;

const AvatarPanel: TemplateOnlyComponent = <template>
  <Row>
    <AvatarGroup>
      <Avatar @name={{avaPanel0}} />
      <Avatar @name={{avaPanel1}} />
      <Avatar @name={{avaPanel2}} />
      <Avatar @name={{avaPanel3}} />
    </AvatarGroup>
    <Mono>+3</Mono>
  </Row>
</template>;

const AvatarWithRole: TemplateOnlyComponent = <template>
  <Row>
    <Avatar @name={{avaChair}} @size={{32}} />
    <span class='ex-id'>
      <Lab>{{avaChair}}</Lab>
      <Mono>cupping panel chair</Mono>
    </span>
  </Row>
  <style scoped>
    .ex-id {
      display: grid;
      gap: 1px;
    }
  </style>
</template>;

// ── Alert ────────────────────────────────────────────────────────────────
const ALE = seedFrom('Alert');
const aleAmount = pick(ALE, 0, AMOUNTS);
const aleTea = pick(ALE, 1, TEAS);
const aleSupplier = pick(ALE, 2, SUPPLIERS);
const aleDate = pick(ALE, 3, DATES);
const alePriceTea = pick(ALE, 4, TEAS);
const alePlace = pick(ALE, 5, PLACES);
const aleHoldDate = pick(ALE, 6, DATES);
const aleConfirmBody =
  aleAmount + ' of ' + aleTea + ' from ' + aleSupplier + ' lands ' + aleDate + '.';
const aleDriftBody =
  alePriceTea + ' has moved 9% since the spring booking was priced.';
const aleHoldBody =
  'The ' + alePlace + ' shipment is held at customs — paperwork due ' + aleHoldDate + '.';

const AlertOrderConfirmed: TemplateOnlyComponent = <template>
  <Alert @tone='success' @title='Order confirmed'>{{aleConfirmBody}}</Alert>
</template>;

const AlertPriceDrift: TemplateOnlyComponent = <template>
  <Alert @tone='warning' @title='Price drift'>
    <:default>{{aleDriftBody}}</:default>
    <:action>
      <Button @tone='warning' @appearance='outlined' @size='xs'>Re-price</Button>
    </:action>
  </Alert>
</template>;

const AlertCustomsHold: TemplateOnlyComponent = <template>
  <Alert @tone='danger' @title='Customs hold'>{{aleHoldBody}}</Alert>
</template>;

// ── Toast ────────────────────────────────────────────────────────────────
const TOA = seedFrom('Toast');
const toaTea = pick(TOA, 0, TEAS);
const toaAmount = pick(TOA, 1, AMOUNTS);
const toaDate = pick(TOA, 2, DATES);
const toaPerson = pick(TOA, 3, PEOPLE);
const toaTagMsg = toaTea + ' · ' + toaAmount;
const toaPublishMsg = 'Live as of ' + toaDate + '.';
const toaAssignMsg = toaPerson + ' owns the restock order.';

const ToastTagged: TemplateOnlyComponent = <template>
  <Toast @title='Batch tagged' @message={{toaTagMsg}} />
</template>;

const ToastPublished: TemplateOnlyComponent = <template>
  <Toast @title='Menu published' @message={{toaPublishMsg}}>
    <:action>
      <Button @tone='neutral' @appearance='plain' @size='xs'>Undo</Button>
    </:action>
  </Toast>
</template>;

const ToastAssigned: TemplateOnlyComponent = <template>
  <Toast @title='Assigned' @message={{toaAssignMsg}}>
    <:icon>
      <Avatar @name={{toaPerson}} @size={{20}} />
    </:icon>
  </Toast>
</template>;

// ── Meter ────────────────────────────────────────────────────────────────
const MET = seedFrom('Meter');
const metSuppliers = take(MET, 0, 2, SUPPLIERS);
const metSuppliers0 = metSuppliers[0];
const metSuppliers1 = metSuppliers[1];
const metHeights = [6, 8, 10, 12, 14];

const MeterStockRows: TemplateOnlyComponent = <template>
  <Stack>
    <Row>
      <Lab>{{metSuppliers0}}</Lab>
      <Meter @level={{1}} @label='Stock: low' />
    </Row>
    <Row>
      <Lab>{{metSuppliers1}}</Lab>
      <Meter @level={{3}} @label='Stock: healthy' />
    </Row>
  </Stack>
</template>;

const MeterHarvest: TemplateOnlyComponent = <template>
  <Meter
    @level={{4}}
    @segments={{5}}
    @heights={{metHeights}}
    @label='Harvest confidence'
  />
</template>;

// ── KeyValue ─────────────────────────────────────────────────────────────
const KV = seedFrom('KeyValue');
const kvOrderItems: KeyValueItem[] = [
  { key: 'Supplier', value: pick(KV, 0, SUPPLIERS) },
  { key: 'Tea', value: pick(KV, 1, TEAS) },
  { key: 'Quantity', value: pick(KV, 2, AMOUNTS) },
  { key: 'Ship date', value: pick(KV, 3, DATES) },
];
const kvShipmentItems: KeyValueItem[] = [
  { key: 'Batch', value: 'lot_' + pick(KV, 4, DATES).replaceAll('-', '').slice(2) },
  { key: 'Owner', value: pick(KV, 5, PEOPLE) },
  { key: 'Status', value: 'curing' },
];
function kvIsStatus(item: KeyValueItem) {
  return item.key === 'Status';
}
function kvIsBatch(item: KeyValueItem) {
  return item.key === 'Batch';
}

const KeyValueOrder: TemplateOnlyComponent = <template>
  <KeyValue @items={{kvOrderItems}} />
</template>;

const KeyValueShipment: TemplateOnlyComponent = <template>
  <KeyValue @items={{kvShipmentItems}}>
    <:value as |item|>
      {{#if (kvIsStatus item)}}
        <StatusChip @value={{item.value}} />
      {{else if (kvIsBatch item)}}
        <Token @value={{item.value}} />
      {{else}}
        {{item.value}}
      {{/if}}
    </:value>
  </KeyValue>
</template>;

// ── Stat ─────────────────────────────────────────────────────────────────
const STA = seedFrom('Stat');
const staPrice = pick(STA, 0, AMOUNTS);
const staSuppliers = String((STA % 20) + 8);
const staOrders = String((STA % 9) + 3);
const staSince = 'since ' + pick(STA, 1, DATES);

const StatKpiRow: TemplateOnlyComponent = <template>
  <div class='ex-stats'>
    <Stat @label='Margin' @value='61%' @delta={{8}} @hint='this season' />
    <Stat @label='Avg price' @value={{staPrice}} @delta={{-3}} @hint='vs spring' />
    <Stat @label='Suppliers' @value={{staSuppliers}} />
  </div>
  <style scoped>
    .ex-stats {
      display: flex;
      gap: var(--space-6, 19px);
      align-items: flex-start;
      flex-wrap: wrap;
    }
  </style>
</template>;

const StatSingle: TemplateOnlyComponent = <template>
  <Stat @label='Open orders' @value={{staOrders}} @hint={{staSince}} />
</template>;

// ── InputGroup ───────────────────────────────────────────────────────────
const IGR = seedFrom('InputGroup');
const igrPrice = pick(IGR, 0, AMOUNTS).replace(/[^0-9.]/g, '');
const igrSupplier = pick(IGR, 1, SUPPLIERS);
const igrPriceHelp = 'What ' + igrSupplier + ' quoted for spring lots.';
const igrSearchPlaceholder =
  'Search ' + String((IGR % 20) + 30) + ' suppliers…';
const igrLot = pick(IGR, 2, DATES).replaceAll('-', '').slice(2);

const InputGroupPrice: TemplateOnlyComponent = <template>
  <InputGroup @value={{igrPrice}} @helperText={{igrPriceHelp}}>
    <:start>$</:start>
    <:end>/kg</:end>
  </InputGroup>
</template>;

const InputGroupSearch: TemplateOnlyComponent = <template>
  <InputGroup @placeholder={{igrSearchPlaceholder}}>
    <:start>⌕</:start>
  </InputGroup>
</template>;

const InputGroupLot: TemplateOnlyComponent = <template>
  <InputGroup
    @value={{igrLot}}
    @readonly={{true}}
    @helperText='Assigned at intake.'
  >
    <:start>LOT-</:start>
  </InputGroup>
</template>;

// ── The gallery map ──────────────────────────────────────────────────────

const EXAMPLES_INLINE: Record<string, ExampleSpec[]> = {
  StatusChip: [
    {
      title: 'Grid column',
      note: 'Hue is hashed from the value — same status, same color on every card.',
      component: StatusChipGridColumn,
    },
    {
      title: 'Batch lifecycle',
      note: 'Each stage keeps its own stable hue.',
      component: StatusChipLifecycle,
    },
  ],
  Chip: [
    {
      title: 'Tag rail',
      note: 'Caller-set hues off the chart ramp.',
      component: ChipTagRail,
    },
    {
      title: 'Dotless',
      note: 'Quiet labels — no status dot to imply state.',
      component: ChipDotless,
    },
    {
      title: 'Beside a title',
      component: ChipAfterTitle,
    },
  ],
  Token: [
    {
      title: 'Jewelry in prose',
      note: 'Machine values set in mono pills; the sentence stays sans.',
      component: TokenInProse,
    },
    {
      title: 'Identifier row',
      note: 'A hue marks the one that needs attention.',
      component: TokenRow,
    },
  ],
  Avatar: [
    {
      title: 'Assignee cell',
      note: 'Initials and hue derive from the name.',
      component: AvatarAssignee,
    },
    {
      title: 'Cupping panel',
      note: 'AvatarGroup overlaps with a card-colored ring; overflow in mono.',
      component: AvatarPanel,
    },
    {
      title: 'With a role line',
      component: AvatarWithRole,
    },
  ],
  Alert: [
    {
      title: 'Order confirmed',
      component: AlertOrderConfirmed,
    },
    {
      title: 'Warning with an action',
      note: 'The fix travels with the news.',
      component: AlertPriceDrift,
    },
    {
      title: 'Danger',
      note: 'role=alert — announced immediately.',
      component: AlertCustomsHold,
    },
  ],
  Toast: [
    {
      title: 'Quiet receipt',
      component: ToastTagged,
    },
    {
      title: 'With an undo',
      note: 'One plain xs action, nothing louder.',
      component: ToastPublished,
    },
    {
      title: 'With an avatar',
      note: 'The icon block takes any small ornament.',
      component: ToastAssigned,
    },
  ],
  Meter: [
    {
      title: 'Stock rows',
      note: 'Discrete beats continuous — each meter ships its judgment as text.',
      component: MeterStockRows,
    },
    {
      title: 'Five segments',
      note: 'Custom heights climb toward the verdict.',
      component: MeterHarvest,
    },
  ],
  KeyValue: [
    {
      title: 'Order facts',
      component: KeyValueOrder,
    },
    {
      title: 'With inline components',
      note: 'The value block swaps in Token and StatusChip per row.',
      component: KeyValueShipment,
    },
  ],
  Stat: [
    {
      title: 'KPI row',
      note: 'Deltas color by sign; hints stay muted.',
      component: StatKpiRow,
    },
    {
      title: 'Single stat',
      component: StatSingle,
    },
  ],
  InputGroup: [
    {
      title: 'Price per kilogram',
      note: 'Accessories share one hairline and one focus ring with the control.',
      component: InputGroupPrice,
    },
    {
      title: 'Search',
      component: InputGroupSearch,
    },
    {
      title: 'Prefixed lot code',
      note: 'Read-only value behind a fixed prefix.',
      component: InputGroupLot,
    },
  ],
};

export const EXAMPLES: Record<string, ExampleSpec[]> = mergeRegistry({
  EXAMPLES_INLINE,
  // per-component galleries last, so source order shows where a gallery moved;
  // the merge throws on duplicates, so ordering decides nothing
  EXAMPLES_BUTTON,
  EXAMPLES_ICON_BUTTON,
  EXAMPLES_INPUT,
  EXAMPLES_SELECT,
  EXAMPLES_CHECKBOX,
  EXAMPLES_SWITCH,
  EXAMPLES_SLIDER,
  EXAMPLES_RATING,
});
