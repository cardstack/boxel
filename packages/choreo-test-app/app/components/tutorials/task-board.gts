import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, styles } from 'glimmer-motion';

const initialTasks = [
  { id: 'outline', title: 'Outline the story' },
  { id: 'prototype', title: 'Build a prototype' },
  { id: 'review', title: 'Review with a teammate' },
];
export class TaskBoard extends Component {
  @tracked tasks = [...initialTasks];
  @tracked duration = 0.4;
  private serial = 0;
  add = () => {
    this.tasks = [
      ...this.tasks,
      { id: `new-${++this.serial}`, title: 'New task' },
    ];
  };
  remove = (id: string) => {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  };
  reverse = () => {
    this.tasks = [...this.tasks].reverse();
  };
  reset = () => {
    this.tasks = [...initialTasks];
  };
  retime = (event: Event) => {
    this.duration = Number((event.target as HTMLInputElement).value);
  };
  <template>
    <section class="tutorial-board" aria-label="Task board tutorial">
      <h2>Plan a small project</h2>
      <p>Add, remove, or reorder tasks—even while they are moving.</p>
      <div><button type="button" {{on "click" this.add}}>Add task</button>
        <button type="button" {{on "click" this.reverse}}>Reverse order</button>
        <button type="button" {{on "click" this.reset}}>Reset tasks</button></div>
      <label>Move duration (seconds)
        <input
          type="range"
          min="0.1"
          max="1.5"
          step="0.1"
          value={{this.duration}}
          {{on "input" this.retime}}
        />
        {{this.duration}}</label>
      <Choreo as |c|>
        <ul>
          {{#each this.tasks key="id" as |task|}}
            <li
              data-task-id={{task.id}}
              {{motion
                id=task.id
                role="task"
                style=(styles borderRadius="12px")
              }}
            >
              <span>{{task.title}}</span><button
                type="button"
                aria-label="Remove {{task.title}}"
                {{on "click" (fn this.remove task.id)}}
              >Remove</button>
            </li>
          {{/each}}
        </ul>
        <c.Sequence>
          <c.Tween @of={{c.removed "task"}} @opacity={{0}} @duration={{0.15}} />
          <c.Move @of={{c.moved "task"}} @duration={{this.duration}} />
          <c.Tween
            @of={{c.inserted "task"}}
            @opacity={{array 0 1}}
            @duration={{0.2}}
          />
        </c.Sequence>
      </Choreo>
      <style>
        .tutorial-board {
          color: #f2ebe4;
          background: #25201b;
          padding: 24px;
          border-radius: 16px;
          font: 16px/1.5 system-ui;
        }
        .tutorial-board button {
          color: #f2ebe4;
          background: #443b33;
          border: 1px solid #8c7764;
          border-radius: 8px;
          padding: 8px 12px;
          margin: 4px;
          cursor: pointer;
        }
        .tutorial-board label {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin: 16px 0;
        }
        .tutorial-board ul {
          list-style: none;
          padding: 0;
          display: grid;
          gap: 10px;
        }
        .tutorial-board li {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          background: #393128;
        }
      </style>
    </section>
  </template>
}
