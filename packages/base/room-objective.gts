import { contains, containsMany, field, Component, Card } from './card-api';
import IntegerCard from './integer';
import BooleanCard from './boolean';
import { RoomCard, RoomMemberCard } from './room';

class View extends Component<typeof RoomObjectiveCard> {
  <template>
    <div data-test-objective>
      <h3>Objective: Make sure that all room members greet eachother by saying
        "Hello"</h3>
      <div>
        <strong data-test-objective-progress>
          Completed
          {{@model.completedMilestones}}
          of
          {{@model.totalMilestones}}
          ({{this.progressPercentage}}%)
        </strong>
      </div>
      <div>
        {{#if @model.isComplete}}
          <strong data-test-objective-is-complete>The objective is completed</strong>
        {{else}}
          The following users need to complete the task:
          <strong data-test-objective-remaining>{{this.remainingUsers}}</strong>
        {{/if}}
      </div>
    </div>
  </template>

  get remainingUsers() {
    return this.args.model
      .usersThatNeedToCompleteTask!.map((u) => u.displayName)
      .sort()
      .join(', ');
  }

  get progressPercentage() {
    return Math.floor(
      (this.args.model.completedMilestones! /
        this.args.model.totalMilestones!) *
        100
    );
  }
}

export class RoomObjectiveCard extends Card {
  @field room = contains(RoomCard);
  @field totalMilestones = contains(IntegerCard, {
    computeVia: function (this: RoomObjectiveCard) {
      return this.room.joinedMembers.length;
    },
  });
  @field completedMilestones = contains(IntegerCard, {
    computeVia: function (this: RoomObjectiveCard) {
      return this.usersThatFinishedTask.length;
    },
  });
  @field usersThatFinishedTask = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomObjectiveCard) {
      let desiredMessages = this.room.messages.filter((m) =>
        m.message.match(/^[\W_b]*[Hh][Ee][Ll][Ll][Oo][\W_\b]*$/)
      );
      return desiredMessages.map((m) => m.author);
    },
  });
  @field usersThatNeedToCompleteTask = containsMany(RoomMemberCard, {
    computeVia: function (this: RoomObjectiveCard) {
      let allUsers = this.room.joinedMembers;
      let completedUserIds = this.usersThatFinishedTask.map((u) => u.userId);
      return allUsers.filter((u) => !completedUserIds.includes(u.userId));
    },
  });
  @field isComplete = contains(BooleanCard, {
    computeVia: function (this: RoomObjectiveCard) {
      return this.completedMilestones === this.totalMilestones;
    },
  });

  static embedded = class Embedded extends View {};
  static isolated = class Embedded extends View {};
  static edit = class Embedded extends View {};
}
