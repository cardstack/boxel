import { contains, containsMany, field, Component, FieldDef } from './card-api';
import BooleanField from './boolean';
import { RoomField, RoomMemberField } from './room';

class View extends Component<typeof RoomObjectiveField> {
  <template>
    <div data-test-objective>
      <h3>Objective: Make sure that all room members greet each other by saying
        "Hello"</h3>
      <div>
        <strong data-test-objective-progress>
          Completed
          {{this.completedMilestones}}
          of
          {{this.totalMilestones}}
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
  get completedUserCount() {
    return this.args.model.usersThatFinishedTask!.length;
  }
  get completedMilestones() {
    return this.args.model.usersThatFinishedTask!.length;
  }
  get totalMilestones() {
    return (
      this.args.model.usersThatFinishedTask!.length +
      this.args.model.usersThatNeedToCompleteTask!.length
    );
  }
  get progressPercentage() {
    return Math.floor((this.completedMilestones / this.totalMilestones) * 100);
  }
}

export class RoomObjectiveField extends FieldDef {
  static displayName = 'RoomObjective';
  @field room = contains(RoomField);
  @field usersThatFinishedTask = containsMany(RoomMemberField, {
    computeVia: function (this: RoomObjectiveField) {
      let desiredMessages = this.room.messages.filter((m) =>
        m.message.match(/^[\W_b]*[Hh][Ee][Ll][Ll][Oo][\W_\b]*$/),
      );
      return [...new Set(desiredMessages.map((m) => m.author))];
    },
  });
  @field usersThatNeedToCompleteTask = containsMany(RoomMemberField, {
    computeVia: function (this: RoomObjectiveField) {
      let allUsers = this.room.joinedMembers;
      let completedUserIds = this.usersThatFinishedTask.map((u) => u.userId);
      return allUsers.filter((u) => !completedUserIds.includes(u.userId));
    },
  });
  @field isComplete = contains(BooleanField, {
    computeVia: function (this: RoomObjectiveField) {
      return this.usersThatNeedToCompleteTask.length === 0;
    },
  });

  static embedded = class Embedded extends View {};
  static isolated = class Embedded extends View {};
  static edit = class Embedded extends View {};
}
