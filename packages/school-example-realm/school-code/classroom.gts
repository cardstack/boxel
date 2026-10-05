import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import {
  Alert,
  BoxelInput,
  Button,
  FieldContainer,
  Pill,
} from '@cardstack/boxel-ui/components';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';
import SchoolIcon from '@cardstack/boxel-icons/school';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  actor,
  instance,
  operation,
  operations,
  params,
  type OperationDeclaration,
} from '@cardstack/base/operations';

import { mirrors, refusalMessage, rosterIds } from './roster-mirror';
import { StaffMember } from './staff-member';

// A note a teacher logs against a classroom. It is only ever minted by
// `Classroom.appendActivity`, which writes `author` and `classroom` itself.
export class ClassroomActivity extends CardDef {
  static displayName = 'Classroom Activity';
  static icon = NotebookPenIcon;

  @field note = contains(StringField);
  @field author = contains(StringField);
  @field classroom = linksTo(() => Classroom);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ClassroomActivity) {
      return this.note?.length
        ? this.note
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='activity'>
        <p class='note'>{{@model.note}}</p>
        <p class='author'>{{@model.author}}</p>
      </div>
      <style scoped>
        .activity {
          padding: var(--boxel-sp-xs);
        }
        p {
          margin: 0;
        }
        .author {
          font-family: var(--font-mono, monospace);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}

class ClassroomIsolated extends Component<typeof Classroom> {
  @tracked note = '';
  @tracked running = false;
  @tracked loggedId: string | undefined;
  @tracked refusal: string | undefined;

  get classroom(): Classroom {
    return this.args.model as Classroom;
  }

  // `canInvoke` asks the realm whether the viewer may run an operation here,
  // through the same gate the invocation passes. A teacher the policy admits
  // gets `true` for `appendActivity`; a realm writer gets `true` for `update`.
  // It is advisory: the realm decides again when the button is pressed.
  get canLogActivity(): boolean {
    return (
      this.args.context?.canInvoke?.('appendActivity', this.classroom) === true
    );
  }

  get canManageRoster(): boolean {
    return this.args.context?.canInvoke?.('update', this.classroom) === true;
  }

  get rosterTeacherIds() {
    return rosterIds(this.classroom.teachers);
  }

  get rosterLeadTeacherIds() {
    return rosterIds(this.classroom.leadTeachers);
  }

  get mirrorIsCurrent(): boolean {
    return (
      mirrors(this.classroom.teacherIds, this.rosterTeacherIds) &&
      mirrors(this.classroom.leadTeacherIds, this.rosterLeadTeacherIds)
    );
  }

  @action updateNote(value: string) {
    this.note = value;
  }

  // A named create anchored on this classroom. The policy decides whether the
  // viewer may run it; the declaration decides what it writes, and it writes
  // the viewer as `author` and this classroom as `classroom` whatever the
  // viewer sends. A teacher cannot read the Education realm, so the realm
  // chooses the new card's id and the answer reports it.
  @action async logActivity() {
    this.refusal = undefined;
    this.loggedId = undefined;
    this.running = true;
    try {
      let result = await operations<typeof Classroom>(
        this.classroom,
      ).appendActivity({ note: this.note });
      this.loggedId = result.id;
      this.note = '';
    } catch (err) {
      this.refusal = refusalMessage(err);
    } finally {
      this.running = false;
    }
  }

  // Copies the ids of the linked staff into the lists the policy reads. Only a
  // realm writer may update a classroom — the policy grants instructors no
  // `update` — so this is the IT admin's step after the roster changes.
  @action async syncStaffIds() {
    this.refusal = undefined;
    this.running = true;
    try {
      await operations(this.classroom).update({
        attributes: {
          teacherIds: this.rosterTeacherIds,
          leadTeacherIds: this.rosterLeadTeacherIds,
        },
      });
    } catch (err) {
      this.refusal = refusalMessage(err);
    } finally {
      this.running = false;
    }
  }

  <template>
    <article class='classroom'>
      <header>
        <h1>{{@model.name}}</h1>
        <p class='subtle'>{{@model.gradeLevel}}</p>
      </header>

      <section>
        <h2>Teachers</h2>
        <ul class='ids'>
          {{#each @model.teacherIds as |id|}}
            <li><Pill @variant='secondary'>{{id}}</Pill></li>
          {{else}}
            <li class='subtle'>No teachers listed</li>
          {{/each}}
        </ul>
        {{#if @model.leadTeacherIds.length}}
          <h3>Lead teachers</h3>
          <ul class='ids'>
            {{#each @model.leadTeacherIds as |id|}}
              <li><Pill @variant='secondary'>{{id}}</Pill></li>
            {{/each}}
          </ul>
        {{/if}}
      </section>

      {{#if this.canLogActivity}}
        <section>
          <h2>Log an activity</h2>
          <FieldContainer @label='Note' @tag='label' @vertical={{true}}>
            <BoxelInput
              @value={{this.note}}
              @onInput={{this.updateNote}}
              @placeholder='What happened in class today?'
            />
          </FieldContainer>
          <Button
            @kind='primary'
            @disabled={{this.running}}
            {{on 'click' this.logActivity}}
          >Log activity</Button>
          {{#if this.loggedId}}
            <p class='subtle logged'>Logged as {{this.loggedId}}</p>
          {{/if}}
        </section>
      {{/if}}

      {{#if this.canManageRoster}}
        <section class='admin'>
          <h2>Roster (IT admin)</h2>
          <p class='subtle'>
            The policy reads the id lists above, not these links. After the
            roster changes, sync the lists so the policy sees the change.
          </p>
          <div class='staff'>
            {{#each @fields.teachers as |Teacher|}}
              <Teacher @format='embedded' />
            {{/each}}
          </div>
          {{#if this.mirrorIsCurrent}}
            <p class='subtle'>The id lists match the roster.</p>
          {{else}}
            <Alert @type='warning' as |Alert|>
              <Alert.Messages
                @messages={{array
                  'The id lists do not match the linked staff, so the policy is deciding on stale ids.'
                }}
              />
            </Alert>
            <Button
              @kind='secondary'
              @disabled={{this.running}}
              {{on 'click' this.syncStaffIds}}
            >Sync ids from the roster</Button>
          {{/if}}
        </section>
      {{/if}}

      {{#if this.refusal}}
        <Alert @type='error' as |Alert|>
          <Alert.Messages @messages={{array this.refusal}} />
        </Alert>
      {{/if}}
    </article>

    <style scoped>
      .classroom {
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      h1 {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
      }
      h2,
      h3 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
      }
      section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        align-items: flex-start;
      }
      .ids {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .subtle {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .logged {
        font-family: var(--font-mono, monospace);
      }
      .admin {
        padding: var(--boxel-sp);
        border: 1px dashed var(--border, var(--boxel-400));
        border-radius: var(--boxel-border-radius);
        align-self: stretch;
      }
      .staff {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
        gap: var(--boxel-sp-xs);
        align-self: stretch;
      }
    </style>
  </template>
}

// A classroom, and the staff attached to it.
//
// `teachers` and `leadTeachers` link to roster cards in the Org realm.
// `teacherIds` and `leadTeacherIds` hold the same people's Matrix ids, because
// the Education realm's policy compares the caller against them: a predicate
// reads the classroom's stored source, where a link is only a URL, so it can
// compare `actor()` with an id list and not with a link. Nothing keeps the two
// in step automatically; the IT admin syncs them from the classroom's page.
//
// The policy pairs a grant that reads `teacherIds` with `appendActivity`, never
// with a raw `update`. An operation is authorized on the classroom as it stands
// before the write, so an `update` the grant admitted could rewrite
// `teacherIds` and move its caller into or out of the grant. `appendActivity`
// cannot reach `teacherIds` at all.
export class Classroom extends CardDef {
  static displayName = 'Classroom';
  static icon = SchoolIcon;

  @field name = contains(StringField);
  @field gradeLevel = contains(StringField);
  @field teachers = linksToMany(StaffMember);
  @field leadTeachers = linksToMany(StaffMember);
  @field teacherIds = containsMany(StringField);
  @field leadTeacherIds = containsMany(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Classroom) {
      return this.name?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // A read names the staff a classroom links to and carries none of their
  // roster cards. A teacher the policy admits would otherwise receive every
  // linked StaffMember with the classroom, though nothing grants them the
  // roster; an IT admin's host fetches each link on its own request instead.
  @operation static read = {
    base: 'read',
    links: 'ids',
  } satisfies OperationDeclaration;

  @operation static appendActivity = {
    base: 'create',
    of: ClassroomActivity,
    params: { note: StringField },
    fill: {
      note: params('note'),
      author: actor(),
      classroom: instance('id'),
    },
  } satisfies OperationDeclaration;

  static isolated = ClassroomIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='classroom-row'>
        <strong>{{@model.name}}</strong>
        <span class='subtle'>{{@model.gradeLevel}}</span>
      </div>
      <style scoped>
        .classroom-row {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-xs);
        }
        .subtle {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
