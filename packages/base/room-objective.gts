import { contains, containsMany, field, Component, Card } from './card-api';
import IntegerCard from './integer';
import { RoomCard, RoomMemberCard } from './room';

export class RoomObjectiveCard extends Card {
  @field room = contains(RoomCard);
  @field totalMilestones = contains(IntegerCard, {
    computeVia: function (this: RoomObjectiveCard) {},
  });
  @field completedMilestones = contains(IntegerCard, {
    computeVia: function (this: RoomObjectiveCard) {},
  });
  @field usersThatFinishedTask = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomObjectiveCard) {},
  });
  @field usersThatNeedToCompleteTask = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomObjectiveCard) {},
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div>
        Completed
        {{@model.completedMilestones}}
        of
        {{@model.totalMilestones}}
      </div>
    </template>
  };
}
