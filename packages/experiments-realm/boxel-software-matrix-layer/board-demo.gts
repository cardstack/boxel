import {
  CardDef,
  Component,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import SquareKanbanIcon from '@cardstack/boxel-icons/square-kanban';
import { realmURL } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Board, type BoardColumn } from './board';
import { Opportunity, PIPELINE_STAGES } from './opportunity';

export class PipelineBoardDemo extends CardDef {
  static displayName = 'Pipeline Board Demo';
  static icon = SquareKanbanIcon;

  @field records = linksToMany(Opportunity);

  static isolated = class Isolated extends Component<
    typeof PipelineBoardDemo
  > {
    columns: BoardColumn[] = PIPELINE_STAGES.map((stage) => ({
      key: stage,
      label: stage,
    }));

    columnKeyFor = (item: CardDef) => (item as Opportunity)?.stage;

    onMove = async (item: CardDef, columnKey: string) => {
      (item as Opportunity).stage = columnKey;
      let commandContext = (this.args as any).context?.commandContext;
      let realm = (this.args.model as any)?.[realmURL]?.href;
      if (commandContext && realm) {
        await new SaveCardCommand(commandContext).execute({
          card: item,
          realm,
        } as any);
      }
    };

    get items() {
      return ((this.args.model.records ?? []) as CardDef[]).filter(Boolean);
    }

    <template>
      <div class='demo'>
        <Board
          @boardLabel='Pipeline'
          @items={{this.items}}
          @columns={{this.columns}}
          @columnKeyFor={{this.columnKeyFor}}
          @onMove={{this.onMove}}
        />
      </div>
      <style scoped>
        .demo {
          height: 100%;
          min-height: 480px;
          padding: 1rem;
          box-sizing: border-box;
        }
      </style>
    </template>
  };
}
