// Pretui — live specimens for the showcase home: each one is the real
// component, running and playable, with a way into its docs page.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { hash } from '@ember/helper';
import { Thinking } from './components/thinking';
import type { ThinkingRow } from './components/thinking';
import { DiffBlock } from './components/diff-block';
import type { DiffLine } from './components/diff-block';
import { AgentQuestion } from './components/agent-question';
import { CompactionChip } from './components/compaction-chip';
import { QueuedMessage } from './components/queued-message';
import { TerminalAnimation } from './components/terminal-animation';
import type { TerminalLine } from './components/terminal-animation';
import { Button } from './components/button';
import { Rating } from './components/rating';
import { Select } from './components/select';
import type { SelectOption } from './components/select';
import { StatusChip } from './components/status-chip';
import { DataGrid } from './components/data-grid';
import type { ColumnSpec } from './components/data-grid';
import { StreamingText } from './components/streaming-text';
import { Transmute } from './components/transmute';
import { WorkItem } from './components/work-item';

export interface Specimen {
  name: string;
  category: string;
  note: string;
}

const AGENT_SPECIMENS: Specimen[] = [
  {
    name: 'Thinking',
    category: 'Agentic',
    note: 'A live reasoning trace that settles into a summary.',
  },
  {
    name: 'DiffBlock',
    category: 'Agentic',
    note: 'A staged change with its receipt, ready to approve.',
  },
  {
    name: 'AgentQuestion',
    category: 'Agentic',
    note: 'The agent asks; the reader answers in one tap.',
  },
  {
    name: 'TerminalAnimation',
    category: 'Agentic',
    note: 'What the agent ran, typed out as it happened.',
  },
  {
    name: 'CompactionChip',
    category: 'Agentic',
    note: 'A long session folded into a summary you can open.',
  },
  {
    name: 'QueuedMessage',
    category: 'Agentic',
    note: 'A follow-up that waits its turn, or jumps the queue.',
  },
];

const FEATURED_SPECIMENS: Specimen[] = [
  {
    name: 'Button',
    category: 'Actions',
    note: 'Every variant, tone and size from one component.',
  },
  {
    name: 'DataGrid',
    category: 'Data Display',
    note: 'Sortable, selectable rows with numbers that line up.',
  },
  {
    name: 'Select',
    category: 'Inputs',
    note: 'A list box that searches, groups and stays accessible.',
  },
  {
    name: 'Rating',
    category: 'Inputs',
    note: 'Half-star precision, hover preview, slider keys.',
  },
  {
    name: 'WorkItem',
    category: 'Agentic',
    note: 'One run of work: what it does, how far it got.',
  },
  {
    name: 'StatusChip',
    category: 'Foundations',
    note: 'A state and its color, from one value.',
  },
  {
    name: 'StreamingText',
    category: 'Agentic',
    note: 'Text that arrives word by word, cursor and all.',
  },
  {
    name: 'Transmute',
    category: 'Agentic',
    note: 'A tool call turned into a sentence people can read.',
  },
];

const THINKING_ROWS: ThinkingRow[] = [
  {
    id: 'a',
    primary: 'Searched open invoices',
    secondary: '48 matches',
    state: 'done',
  },
  {
    id: 'b',
    primary: 'Reading invoices.csv',
    secondary: 'invoices.csv',
    mono: true,
    state: 'running',
  },
];

const DIFF: DiffLine[] = [
  { text: 'status: draft' },
  { op: 'del', text: 'dueDate: 2026-12-01' },
  { op: 'add', text: 'dueDate: 2026-12-15' },
  { op: 'add', text: 'reminder: true' },
];

const TERMINAL: TerminalLine[] = [
  { id: '1', kind: 'command', text: 'boxel lint --realm crm' },
  { id: '2', kind: 'output', text: 'Linted 42 files' },
  { id: '3', kind: 'comment', text: '# no problems found' },
];

const ANSWERS = ['Send now', 'Wait a week'];

const REGIONS: SelectOption[] = [
  { value: 'lisbon', label: 'Lisbon' },
  { value: 'kyoto', label: 'Kyoto' },
  { value: 'oaxaca', label: 'Oaxaca' },
];

const COLUMNS: ColumnSpec[] = [
  { key: 'tea', label: 'Tea', sortable: true },
  { key: 'stock', label: 'Stock', num: true, sortable: true },
];

const ROWS = [
  { id: 1, tea: 'Hojicha', stock: 24 },
  { id: 2, tea: 'Genmaicha', stock: 40 },
  { id: 3, tea: 'Sencha', stock: 12 },
];

function noop() {}

// specimens that read best stretched across the stage
const WIDE = ['DataGrid', 'WorkItem', 'StreamingText', 'Transmute'];

interface WallSignature {
  Args: {
    /** open a component's docs page */
    onOpen: (name: string, category: string) => void;
  };
  Element: HTMLElement;
}

class SpecimenFoot extends Component<{
  Args: {
    specimen: Specimen;
    onOpen: (name: string, category: string) => void;
  };
}> {
  open = () =>
    this.args.onOpen(this.args.specimen.name, this.args.specimen.category);
  <template>
    <footer class='spec-foot'>
      <div class='spec-head'>
        <span class='spec-name'>{{@specimen.name}}</span>
        <button
          type='button'
          class='spec-open'
          data-test-showcase-specimen-open
          aria-label='Open the {{@specimen.name}} docs'
          {{on 'click' this.open}}
        >Docs →</button>
      </div>
      <p class='spec-note'>{{@specimen.note}}</p>
    </footer>
  </template>
}

export class AgentWall extends Component<WallSignature> {
  specimens = AGENT_SPECIMENS;
  is = (specimen: Specimen, name: string) => specimen.name === name;
  <template>
    <ul class='wall' ...attributes>
      {{#each this.specimens as |s|}}
        <li class='spec' data-specimen={{s.name}}>
          <div class='spec-stage'>
            {{#if (this.is s 'Thinking')}}
              <Thinking
                @working={{true}}
                @label='Checking overdue invoices'
                @rows={{THINKING_ROWS}}
                @defaultExpanded={{true}}
              />
            {{else if (this.is s 'DiffBlock')}}
              <DiffBlock @lines={{DIFF}} @receipt='invoice-0042.json' />
            {{else if (this.is s 'AgentQuestion')}}
              <AgentQuestion
                @question='Two invoices are 30 days late. Send reminders?'
                @options={{ANSWERS}}
              />
            {{else if (this.is s 'TerminalAnimation')}}
              <TerminalAnimation
                @lines={{TERMINAL}}
                @title='agent shell'
                @label='The agent linting a realm'
              />
            {{else if (this.is s 'CompactionChip')}}
              <CompactionChip
                @state='done'
                @messageCount={{64}}
                @toolCallCount={{21}}
                @summary='Reconciled Q3 invoices; two reminders drafted.'
              />
            {{else}}
              <QueuedMessage
                @text='Also cc the account owner on both reminders.'
                @mode='steer'
                @onSendNow={{noop}}
                @onEdit={{noop}}
              />
            {{/if}}
          </div>
          <SpecimenFoot @specimen={{s}} @onOpen={{@onOpen}} />
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .wall {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
        gap: 1.25rem;
      }
      .spec {
        display: grid;
        grid-template-rows: minmax(14rem, 1fr) auto;
        border-radius: calc(var(--radius, 0.75rem) + 0.25rem);
        background: var(--card, var(--background));
        color: var(--card-foreground, var(--foreground));
        border: 1px solid var(--border);
        overflow: hidden;
        box-shadow: 0 20px 50px -30px rgb(0 0 0 / 0.6);
      }
      .spec-stage {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-content: center;
        justify-items: stretch;
        padding: 1.75rem 1.5rem;
        overflow: hidden;
        min-width: 0;
        background:
          radial-gradient(
            90% 80% at 50% 0%,
            color-mix(in oklab, var(--primary) 8%, transparent),
            transparent 70%
          ),
          var(--background);
      }
      .spec-stage > :deep(*) {
        min-width: 0;
        max-width: 100%;
      }
      .spec :deep(.spec-foot) {
        display: grid;
        gap: 0.25rem;
        padding: 0.875rem 1.125rem 1rem;
        border-top: 1px solid var(--border);
        background: var(--card, var(--background));
      }
      .spec :deep(.spec-head) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .spec :deep(.spec-name) {
        font-weight: 650;
        font-size: 0.9375rem;
        letter-spacing: -0.01em;
      }
      .spec :deep(.spec-note) {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground);
        line-height: 1.45;
      }
      .spec :deep(.spec-open) {
        flex: none;
        padding: 0.25rem 0.5rem;
        border: 0;
        border-radius: var(--radius, 0.375rem);
        background: transparent;
        color: var(--primary);
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
      }
      .spec :deep(.spec-open:hover) {
        background: color-mix(in oklab, var(--primary) 12%, transparent);
      }
    </style>
  </template>
}

export class FeaturedGallery extends Component<WallSignature> {
  specimens = FEATURED_SPECIMENS;
  regions = REGIONS;
  is = (specimen: Specimen, name: string) => specimen.name === name;
  isWide = (specimen: Specimen) => WIDE.includes(specimen.name);
  <template>
    <ul class='gallery' ...attributes>
      {{#each this.specimens as |s|}}
        <li class='spec' data-specimen={{s.name}}>
          <div class='spec-stage {{if (this.isWide s) "wide"}}'>
            {{#if (this.is s 'Button')}}
              <div class='row'>
                <Button @variant='primary'>Save</Button>
                <Button @variant='secondary'>Cancel</Button>
                <Button @variant='ghost'>More</Button>
              </div>
            {{else if (this.is s 'DataGrid')}}
              <DataGrid
                @columns={{COLUMNS}}
                @rows={{ROWS}}
                @rowKey='id'
                @defaultSort={{hash key='stock' dir='desc'}}
              />
            {{else if (this.is s 'Select')}}
              <Select
                @options={{this.regions}}
                @defaultValue='kyoto'
                @label='Warehouse'
              />
            {{else if (this.is s 'Rating')}}
              <Rating
                @defaultValue={{3.5}}
                @precision={{0.5}}
                @label='Your rating'
              />
            {{else if (this.is s 'WorkItem')}}
              <WorkItem
                @tier='run'
                @state='running'
                @verb='Reconciling'
                @title='Q3 supplier invoices'
                @progressValue={{32}}
                @progressMax={{48}}
                @count='32 of 48'
              />
            {{else if (this.is s 'StatusChip')}}
              <div class='row wrap'>
                <StatusChip @value='live' />
                <StatusChip @value='in review' />
                <StatusChip @value='blocked' />
                <StatusChip @value='planned' />
              </div>
            {{else if (this.is s 'StreamingText')}}
              <p class='prose'><StreamingText
                  @text='Three suppliers shipped late this quarter, all from the same port.'
                  @rate={{10}}
                  @cursor={{true}}
                /></p>
            {{else}}
              <p class='prose'><Transmute
                  @verb='Searched'
                  @label='open invoices'
                  @call='search({ status: "open" })'
                /></p>
            {{/if}}
          </div>
          <SpecimenFoot @specimen={{s}} @onOpen={{@onOpen}} />
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .gallery {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
        gap: 1.25rem;
      }
      .spec {
        display: grid;
        grid-template-rows: minmax(13rem, 1fr) auto;
        border-radius: calc(var(--radius, 0.75rem) + 0.25rem);
        background: var(--card, var(--background));
        border: 1px solid var(--border);
        overflow: hidden;
        transition:
          border-color 0.2s ease,
          box-shadow 0.2s ease;
      }
      .spec:hover {
        border-color: color-mix(in oklab, var(--primary) 45%, var(--border));
        box-shadow: 0 18px 40px -26px
          color-mix(in oklab, var(--primary) 60%, transparent);
      }
      .spec-stage {
        display: grid;
        place-items: center;
        padding: 1.75rem 1.5rem;
        min-width: 0;
        overflow: hidden;
        background:
          linear-gradient(
              color-mix(in oklab, var(--foreground) 4%, transparent) 1px,
              transparent 1px
            )
            0 0 / 100% 1.25rem,
          linear-gradient(
              90deg,
              color-mix(in oklab, var(--foreground) 4%, transparent) 1px,
              transparent 1px
            )
            0 0 / 1.25rem 100%,
          var(--muted, var(--background));
      }
      .spec-stage > :deep(*) {
        max-width: 100%;
      }
      .spec-stage.wide {
        justify-items: stretch;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .row.wrap {
        flex-wrap: wrap;
        justify-content: center;
      }
      .prose {
        margin: 0;
        font-size: 0.9375rem;
        line-height: 1.5;
      }
      .spec :deep(.spec-foot) {
        display: grid;
        gap: 0.25rem;
        padding: 0.875rem 1.125rem 1rem;
        border-top: 1px solid var(--border);
        background: var(--card, var(--background));
      }
      .spec :deep(.spec-head) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .spec :deep(.spec-name) {
        font-weight: 650;
        font-size: 0.9375rem;
        letter-spacing: -0.01em;
      }
      .spec :deep(.spec-note) {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground);
        line-height: 1.45;
      }
      .spec :deep(.spec-open) {
        flex: none;
        padding: 0.25rem 0.5rem;
        border: 0;
        border-radius: var(--radius, 0.375rem);
        background: transparent;
        color: var(--primary);
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
      }
      .spec :deep(.spec-open:hover) {
        background: color-mix(in oklab, var(--primary) 12%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        .spec {
          transition: none;
        }
      }
    </style>
  </template>
}
