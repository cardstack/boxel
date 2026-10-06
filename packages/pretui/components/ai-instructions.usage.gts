// Pretui — AiInstructions usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { AiInstructions } from './ai-instructions';
import type { AiInstruction } from './ai-instructions';

// ── AiInstructions ───────────────────────────────────────────────────────
const SEED_INSTRUCTIONS: AiInstruction[] = [
  {
    id: 'i1',
    text: 'Quote prices in USD per kilo, landed, never per pound.',
    enabled: true,
  },
  {
    id: 'i2',
    text: 'Never bid without naming the comparable lot you priced against.',
    enabled: true,
    note: 'from the sourcing-desk skill',
  },
  {
    id: 'i3',
    text: 'Prefer Nuwara Eliya estates when cupping scores tie.',
    enabled: false,
  },
];

class AiInstructionsUsage extends GlimmerComponent {
  @tracked instructions: AiInstruction[] = SEED_INSTRUCTIONS;
  @tracked nextId = 4;

  add = (text: string) => {
    this.instructions = [
      ...this.instructions,
      { id: 'i' + this.nextId, text, enabled: true },
    ];
    this.nextId = this.nextId + 1;
  };
  toggle = (instruction: AiInstruction, enabled: boolean) => {
    this.instructions = this.instructions.map((i) =>
      i.id === instruction.id ? { ...i, enabled } : i,
    );
  };
  remove = (instruction: AiInstruction) => {
    this.instructions = this.instructions.filter((i) => i.id !== instruction.id);
  };
  reset = () => (this.instructions = SEED_INSTRUCTIONS);

  <template>
    <FreestyleUsage
      @name='AiInstructions'
      @description='Standing instructions are the part of an agent’s behaviour a person can actually edit, so the surface makes three things easy: read what is in force, switch one off without losing it, and add another. Switching off rather than deleting is the design decision worth naming — an instruction you disabled is a decision you can revisit, an instruction you deleted is one you will re-type from memory next week — which is why the switch is first in the row and Remove is the hover-revealed secondary. That remove control appears on :focus-within as well as :hover, and is permanently visible at 44px on coarse pointers, because hover is never the only affordance. An instruction that is off is struck through and labelled "off", so the state survives greyscale, and the in-force count is announced politely on every change.'
    >
      <:example>
        <AiInstructions
          @instructions={{this.instructions}}
          @description='Sent with every message in this session, ahead of your prompt.'
          @max={{8}}
          @onAdd={{this.add}}
          @onToggle={{this.toggle}}
          @onRemove={{this.remove}}
        />
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.reset}}
        >Reset</Button>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='instructions'
          @description='{ id, text, enabled?, note? }. `enabled` defaults to true — an instruction with no flag is in force, which is the only defensible default for a list of rules. `note` carries provenance ("from the workspace skill") so an inherited rule is distinguishable from one you typed.'
          @value={{this.instructions}}
        />
        <Args.Number
          @name='max'
          @description='How many are allowed. Shows a "3 of 8" counter and disables the add field with a helper line at the limit, rather than silently swallowing the submit.'
          @value={{8}}
          @hideControls={{true}}
        />
        <Args.Base
          @name='onAdd / onToggle / onRemove'
          @description='All three are optional and each one gates its own affordance: no @onAdd and the form does not render, no @onRemove and the row has no remove button. The component never mutates the list — it reports, and the caller returns new data.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='title / description / placeholder / emptyMessage'
          @description='The heading pair, the add-field hint, and what the empty shelf says. Empty is EmptyState, so this surface never renders a blank frame.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AI_INSTRUCTIONS: Record<string, unknown> = {
  AiInstructions: AiInstructionsUsage,
};
