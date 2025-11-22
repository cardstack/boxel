# Workflows for Card Generation

We introduce a new "pattern" in cards that support workflows ie running of multiple commands that chain together

## Summary & Motivation
- Provide a repeatable way to track **generation script for cards** without re‑authoring each command invocation
- Manually persist every workflow step on the card so creators can pause, tweak inputs, and rerun only the steps they need
- Compose workflows as data—every step references its command via `codeRef`, so the card itself documents which executable code produced each output.
- Visualize long-running tasks directly on the card via shared progress + accordion components, giving authors immediate feedback while the workflow runs.
- This is motivated by the use-case of generating 100+ cards with AI where the creation results might be unpredictable.

## Examples

We exemplify this with 2 examples 
- `CardCreator`: creates ANY cards in a realm
- `SpecCreator`: creates Specs in a realm

## New Pattern to Compose Commands


Each workflow step persists the cards used as command input/output so they can be replayed later.

```ts
// Your custom steps
class FindSpecWorkflowStepField extends WorkflowStepField {
  ...
}

class CreateSpecWorkflowStepField extends WorkflowStepField {
  // `input` captures the card instance fed into the command when it first runs.
  @field input = linksTo(CreateSpecsInput);
  // `output` stores the resulting card so other steps or reruns can reuse the data.
  @field output = linksTo(CreateSpecsResult);
  // `previous` points at the prior step’s `output`, letting this step chain results.
  @field previous = linksTo(SearchCardsResult);
  // `buildArgs` derives a fresh `input` from `previous` when one was not cached.
  @field buildArgs = linksTo(CreateSpecsInput, {
    computeVia: function (this: CreateSpecWorkflowStepField) {
      if (this.input) {
        return this.input;
      }

      let specFromPreviousStep = this.previous?.specs?.[0];
      if (!specFromPreviousStep) {
        return null;
      }

      return new CreateSpecsInput({
        codeRef: specFromPreviousStep.codeRef,
        module: specFromPreviousStep.module,
        targetRealm: specFromPreviousStep.targetRealm,
      });
    },
  })

}

class GenerateReadmeWorkflowStepField extends WorkflowStepField {
  ...
}

// Each workflow card exports a helper that seeds defaults and copies parent-card data
function createDefaultWorkflowStepFields(
  codeRef: any,
  targetRealm: string | null,
) {
  // Central place to include default steps and mutate them with data pulled
  // from the card (code refs, realms, prompts, local directories, etc).
  let createSpec = new CreateSpecWorkflowStepField({ ... });
  createSpec.codeRef = codeRef;
  createSpec.targetRealm = targetRealm ?? '';
  return [createSpec];
}

class SpecCreatorIsolated extends Component<typeof SpecCreator> {
  onStateChange = async (): Promise<void> => {
    //assignment to
  }

  workflowState = workflowResource(
    this,
    () => this.stepDefinitions,
    this.commandContext!,
    this.onStateChange,
  );

}



```



This “compose commands as data” approach lets us string together any command by just storing its code reference, rather than hard-coding imports per workflow.

## Workflow Step Field & Workflow Step

Because we need a form of persistence, we have a `WorkflowStepField` which will be saved inside a `containsMany` field on a card

```ts
// Field definition persisted on the card
export class WorkflowStepField extends FieldDef {
  @field stepId = contains(StringField);
  @field commandRef = contains(CodeRefField);
  @field input = linksTo(CardDef); 
  @field output = linksTo(CardDef);
  @field codeRef = contains(CodeRefField);    
  @field targetRealm = contains(StringField); 
}

// Runtime interface that the resource produces
export interface WorkflowStepInterface<
  CardResultType extends CardDefConstructor,
> extends CommandInvocation<CardResultType> {
  id: string;
  label: string;
  description: string;
  format: Format | undefined;
  commandRef: ResolvedCodeRef;
  field: WorkflowStepField;
  state: CommandInvocationStatus;
  reset(): void;
  run(
    input: any,
    commandContext: CommandContext,
  ): Promise<CardInstance<CardResultType> | null>;
}

// Runtime wrapper that executes the command behind each field
let stepField = new WorkflowStepField({  ... });
let step = new WorkflowStep(stepField);
await step.run(await step.createInput(commandContext), commandContext);
```


- `WorkflowStepField` keeps the JSON-serializable description of the step (labels, command reference, cached input/output cards).
- `WorkflowStep` (see `workflow-step.ts`) turns that data into a real `CommandInvocation`, loading the command via `commandRef` and managing execution state/loading/errors.

Each `WorkflowStep` and the containing workflow expose a `state` derived from their underlying `CommandInvocation` -- idle, pending, success, and error. These are the same states used as `commandData` resource



## NEW Abstractions

### Components
- **`NotificationBubble`** – Lightweight status callout that highlights inline workflow messaging (idle/pending/success/error) via the `@type` argument and renders the provided `@message` with matching colors.


- **`PaginatedCards`** – Glimmer component that renders card search results with live pagination, automatically resetting when realm/codeRef inputs change. The query is paginated.

- **`WorkflowProgress`** – Slim timeline widget that consumes `workflowState.steps` and renders a circle + connector for each `WorkflowStep`. Each node/line picks CSS classes from the step’s current `state`, so pending pulses, success stays green, and errors light up red, giving an at-a-glance read on how far the workflow made it before stopping.


### Resources
- **`WorkflowRunner`** – Ember resource (`workflowResource`) that turns the serialized `WorkflowStepField[]` from a card into live `WorkflowStep` instances, executes them sequentially, and mirrors each step’s `state` so the UI can surface idle/pending/success/error. It caches every step’s input/output in a `TrackedMap`, letting later steps reuse prior results, making reruns idempotent, and enabling `save(realm)` to persist both inputs and outputs through `SaveCardCommand`. The runner exposes helpers (`run`, `runStep`, `reset`, `getStepResult`, `activeStep`, `result`) so cards and components can drive buttons/progress indicators without duplicating orchestration logic.
