import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import { eq, gt, not } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import CheckIcon from '@cardstack/boxel-icons/check';
import ListIcon from '@cardstack/boxel-icons/list';
import ClipboardIcon from '@cardstack/boxel-icons/clipboard';
import { IconButton } from '@cardstack/boxel-ui/components';
import { IconTrash } from '@cardstack/boxel-ui/icons';
import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';

// TodoItem Field Definition
export class TodoItem extends FieldDef {
  static displayName = 'Todo Item';
  static icon = ClipboardIcon;

  @field text = contains(StringField);
  @field isCompleted = contains(BooleanField);
  @field createdAt = contains(DateField, {
    computeVia: function () {
      return new Date();
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: TodoItem) {
      return this.text || 'New Todo';
    },
  });
}

// TodoItem Component
interface TodoItemComponentArgs {
  Args: {
    todo: TodoItem;
    onDelete: (todo: TodoItem) => void;
    onToggle: (todo: TodoItem) => void;
    onEdit: (todo: TodoItem, newText: string) => void;
  };
}

class TodoItemComponent extends GlimmerComponent<TodoItemComponentArgs> {
  @tracked isEditing = false;
  @tracked editText = '';

  // Getters
  get safeText(): string {
    return this.args.todo?.text || '';
  }

  // Event Handlers
  startEditing = (): void => {
    this.editText = this.safeText;
    this.isEditing = true;
  };

  @action
  updateEditText(event: Event) {
    this.editText = (event.target as HTMLInputElement).value;
  }

  saveEdit = (): void => {
    if (this.editText?.trim()) {
      this.args.onEdit(this.args.todo, this.editText);
    }
    this.isEditing = false;
  };

  cancelEdit = (): void => {
    this.isEditing = false;
  };

  handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      this.saveEdit();
    } else if (event.key === 'Escape') {
      this.cancelEdit();
    }
  };

  toggleCompletion = (): void => {
    this.args.onToggle(this.args.todo);
  };

  deleteTodo = (): void => {
    if (this.args.onDelete) {
      this.args.onDelete(this.args.todo);
    }
  };

  <template>
    <article class='todo-item {{if @todo.isCompleted "completed"}}'>
      <div class='todo-view'>
        <div class='todo-checkbox-container'>
          <input
            type='checkbox'
            class='todo-checkbox'
            checked={{@todo.isCompleted}}
            {{on 'change' this.toggleCompletion}}
            aria-label='Toggle todo completion'
          />
          <span class='custom-checkbox'>
            {{#if @todo.isCompleted}}
              <CheckIcon />
            {{/if}}
          </span>
        </div>

        {{#if this.isEditing}}
          <div class='todo-edit'>
            <input
              class='edit-field'
              value={{this.editText}}
              {{on 'input' this.updateEditText}}
              {{on 'keydown' this.handleKeyDown}}
              {{on 'blur' this.saveEdit}}
              aria-label='Edit todo text'
            />
          </div>
        {{else}}
          <div
            class='todo-text'
            role='button'
            tabindex='0'
            {{on 'dblclick' this.startEditing}}
          >
            {{if @todo.text @todo.text 'Empty todo'}}
          </div>

          <IconButton
            @icon={{IconTrash}}
            @width='18px'
            @height='18px'
            class='delete-button'
            {{on 'click' this.deleteTodo}}
            aria-label='Remove todo'
          />
        {{/if}}
      </div>
    </article>

    <style scoped>
      .todo-item {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0.75rem 0.85rem;
        border-bottom: 1px solid #ededed;
        position: relative;
        font-size: 1.25rem;
        background: white;
        cursor: auto;
        transition: background-color 0.2s ease;
        min-height: 50px;
      }

      .todo-item:hover {
        background-color: #f9fafb;
      }

      .todo-view {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
      }

      .todo-checkbox-container {
        position: relative;
        width: 1rem;
        height: 1rem;
        margin-right: 0.85rem;
        cursor: pointer;
        flex-shrink: 0;
      }

      .todo-checkbox {
        position: absolute;
        opacity: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
        z-index: 1;
      }

      .custom-checkbox {
        position: absolute;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 1.25rem;
        height: 1.25rem;
        border: 2px solid #e5e7eb;
        border-radius: 4px;
        transition: all 0.2s ease;
        background: white;
        color: transparent;
      }

      .todo-checkbox:checked ~ .custom-checkbox {
        border-color: #3b82f6;
        background: #3b82f6;
        color: white;
      }

      .todo-checkbox:hover ~ .custom-checkbox {
        border-color: #3b82f6;
      }

      .todo-text {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        font-size: 1rem;
        padding: 0;
        margin: 0;
        word-break: break-word;
      }

      .completed .todo-text {
        color: #9ca3af;
        text-decoration: line-through;
      }

      .todo-edit {
        width: 100%;
      }

      .edit-field {
        width: 100%;
        font-size: 1rem;
        padding: 0.25rem;
        border-radius: 4px;
        outline: 1px solid #eeeeee;
        border: 1px solid transparent;
      }

      .edit-field:focus,
      .edit-field:focus-visible {
        border: 1px solid #eeeeee;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
      }

      .delete-button {
        --boxel-icon-button-width: 1rem;
        --boxel-icon-button-height: 1rem;
        opacity: 0;
        color: #f87171;
        background: none;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        transform: translateX(10px);
      }

      .todo-item:hover .delete-button {
        opacity: 1;
        transform: translateX(0);
      }

      .delete-button:hover {
        color: #ef4444;
        transform: scale(1.1);
      }
    </style>
  </template>
}

// Isolated Template
class IsolatedTemplate extends Component<typeof TodoMvc> {
  @tracked newTodoText = '';
  @tracked currentFilter = 'all';

  // Add new action method for input handling
  @action
  updateNewTodoText(event: Event) {
    this.newTodoText = (event.target as HTMLInputElement).value;
  }

  // Getters
  get filteredTodos() {
    if (!Array.isArray(this.args.model.todos)) {
      return [];
    }

    switch (this.currentFilter) {
      case 'active':
        return this.args.model.todos.filter((todo) => !todo.isCompleted);
      case 'completed':
        return this.args.model.todos.filter((todo) => todo.isCompleted);
      default:
        return this.args.model.todos;
    }
  }

  get activeTodoCount() {
    if (!Array.isArray(this.args?.model?.todos)) return 0;
    return this.args.model.todos.filter((todo) => !todo.isCompleted).length;
  }

  get completedTodoCount() {
    if (!Array.isArray(this.args?.model?.todos)) return 0;
    return this.args.model.todos.filter((todo) => todo.isCompleted).length;
  }

  get allCompleted() {
    if (
      !Array.isArray(this.args?.model?.todos) ||
      this.args.model.todos.length === 0
    ) {
      return false;
    }
    return this.activeTodoCount === 0;
  }

  get footerShouldShow() {
    if (!Array.isArray(this.args?.model?.todos)) return false;
    return this.args.model.todos.length > 0;
  }

  get hasTodos() {
    if (!Array.isArray(this.args?.model?.todos)) return false;
    return this.args.model.todos.length > 0;
  }

  // Event Handlers
  addTodo = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && this.newTodoText.trim()) {
      const newTodo = new TodoItem({
        text: this.newTodoText.trim(),
        isCompleted: false,
      });

      const currentTodos = Array.isArray(this.args.model.todos)
        ? this.args.model.todos
        : [];
      this.args.model.todos = [...currentTodos, newTodo];

      this.newTodoText = '';
    }
  };

  toggleAll = () => {
    if (!Array.isArray(this.args.model.todos)) return;

    const setTo = this.activeTodoCount > 0;
    const updatedTodos = this.args.model.todos.map((todo) => {
      todo.isCompleted = setTo;
      return todo;
    });
    this.args.model.todos = updatedTodos;
  };

  clearCompleted = () => {
    if (!Array.isArray(this.args.model.todos)) return;

    this.args.model.todos = this.args.model.todos.filter(
      (todo) => !todo.isCompleted,
    );
  };

  deleteTodo = (todoToDelete: TodoItem) => {
    if (!Array.isArray(this.args.model.todos)) return;

    this.args.model.todos = this.args.model.todos.filter(
      (todo) => todo !== todoToDelete,
    );
  };

  onFilterChange = (filter: string) => {
    this.currentFilter = filter;
    this.args.model.filter = filter;
  };

  toggleTodo = (todo: TodoItem) => {
    if (!Array.isArray(this.args.model.todos)) return;
    todo.isCompleted = !todo.isCompleted;
    this.args.model.todos = [...this.args.model.todos];
  };

  editTodo = (todo: TodoItem, newText: string) => {
    if (!Array.isArray(this.args.model.todos)) return;

    todo.text = newText;
    this.args.model.todos = [...this.args.model.todos];
  };

  <template>
    <div class='todoapp-container'>
      <h1>todos</h1>
      <main class='todoapp'>
        <header class='new-todo-container'>
          <div class='toggle-all-container'>
            <input
              type='checkbox'
              class='toggle-all-checkbox'
              checked={{this.allCompleted}}
              disabled={{not this.hasTodos}}
              aria-label='Toggle all todos'
              {{on 'change' this.toggleAll}}
            />
            <span class='custom-checkbox'>
              {{#if this.allCompleted}}
                <CheckIcon />
              {{/if}}
            </span>
          </div>

          <input
            class='new-todo-input'
            placeholder='What needs to be done?'
            value={{this.newTodoText}}
            {{on 'input' this.updateNewTodoText}}
            {{on 'keydown' this.addTodo}}
            aria-label='New todo text'
          />
        </header>

        <section class='main'>
          {{#if (gt this.filteredTodos.length 0)}}
            <ul class='todo-list' role='list'>
              {{#each this.filteredTodos as |todo|}}
                <li>
                  <TodoItemComponent
                    @todo={{todo}}
                    @onDelete={{this.deleteTodo}}
                    @onToggle={{this.toggleTodo}}
                    @onEdit={{this.editTodo}}
                  />
                </li>
              {{/each}}
            </ul>
          {{else}}
            <div class='empty-state'>
              <p>{{#if this.hasTodos}}No
                  {{this.currentFilter}}
                  tasks{{else}}Add your first todo!{{/if}}</p>
            </div>
          {{/if}}
        </section>

        {{#if this.footerShouldShow}}
          <footer class='footer' aria-label='Todo list controls'>
            <span class='todo-count'>
              <strong>{{this.activeTodoCount}}</strong>
              {{if (eq this.activeTodoCount 1) 'item' 'items'}}
              left
            </span>

            <nav class='filters' role='navigation' aria-label='Todo filters'>
              <ul class='filters-list' role='list'>
                <li>
                  <a
                    href='#/'
                    class={{if (eq this.currentFilter 'all') 'selected'}}
                    {{on 'click' (fn this.onFilterChange 'all')}}
                  >
                    All
                  </a>
                </li>
                <li>
                  <a
                    href='#/active'
                    class={{if (eq this.currentFilter 'active') 'selected'}}
                    {{on 'click' (fn this.onFilterChange 'active')}}
                  >
                    Active
                  </a>
                </li>
                <li>
                  <a
                    href='#/completed'
                    class={{if (eq this.currentFilter 'completed') 'selected'}}
                    {{on 'click' (fn this.onFilterChange 'completed')}}
                  >
                    Completed
                  </a>
                </li>
              </ul>
            </nav>

            {{#if this.completedTodoCount}}
              <button
                class='clear-completed'
                {{on 'click' this.clearCompleted}}
                aria-label='Clear completed todos'
              >
                Clear completed
              </button>
            {{/if}}
          </footer>
        {{/if}}
      </main>

      <footer class='info' aria-label='Todo app information'>
        <p>Double-click to edit a todo</p>
        <p>Created with
          <a
            href='https://boxel.ai'
            target='_blank'
            rel='noopener noreferrer'
          >Boxel</a></p>
        <p>Part of
          <a
            href='http://todomvc.com'
            target='_blank'
            rel='noopener noreferrer'
          >TodoMVC</a></p>
      </footer>
    </div>

    <style scoped>
      .todoapp-container {
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
          Arial, sans-serif;
        background: var(--boxel-50);
        min-height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow-y: auto;
        padding: 1rem;
      }

      .todoapp {
        background: #fff;
        margin-top: 1rem;
        position: relative;
        box-shadow:
          0 2px 4px 0 rgba(0, 0, 0, 0.2),
          0 25px 50px 0 rgba(0, 0, 0, 0.1);
        width: 550px;
        max-width: 100%;
      }

      h1 {
        font-size: 4rem;
        font-weight: 100;
        text-align: center;
        text-rendering: optimizeLegibility;
        margin: 0;
      }

      .new-todo-container {
        position: relative;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0.85rem;
        font-size: 1rem;
        overflow: hidden;
        width: 100%;
      }

      .toggle-all-container {
        position: relative;
        width: 1rem;
        height: 1rem;
        margin-right: 0.85rem;
        cursor: pointer;
        flex-shrink: 0;
      }

      .toggle-all-checkbox {
        position: absolute;
        opacity: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
        z-index: 1;
      }

      .custom-checkbox {
        position: absolute;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 1.25rem;
        height: 1.25rem;
        border: 2px solid #e5e7eb;
        border-radius: 4px;
        transition: all 0.2s ease;
        background: white;
        color: transparent;
      }

      .toggle-all-checkbox:checked ~ .custom-checkbox {
        border-color: #3b82f6;
        background: #3b82f6;
        color: white;
      }

      .toggle-all-checkbox:hover ~ .custom-checkbox {
        border-color: #3b82f6;
      }

      .toggle-all-checkbox:disabled ~ .custom-checkbox {
        border-color: #dddddd;
        background: #eeeeee;
        cursor: not-allowed;
        opacity: 0.5;
      }
      .new-todo-input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        font-size: 1.3rem;
        font-style: italic;
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        padding: 0;
      }

      .new-todo-input::placeholder {
        color: #ccc;
        font-weight: 300;
      }

      .main {
        position: relative;
        z-index: 2;
        border-top: 1px solid #e6e6e6;
      }

      .todo-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .empty-state {
        background: var(--boxel-50);
        padding: 1rem;
        text-align: center;
        color: #9ca3af;
        font-style: italic;
      }

      .footer {
        color: #777;
        padding: 10px 15px;
        text-align: center;
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.35rem;
      }

      .todo-count {
        font-size: 0.85rem;
        text-align: left;
        font-size: 0.85rem;
      }

      .filters {
        margin: 0;
        padding: 0;
        list-style: none;
        display: inline-flex;
        gap: 0.35rem;
      }

      .filters ul {
        margin-block: 0;
        padding-inline-start: 0;
      }

      .filters li {
        display: inline;
      }

      .filters li a {
        color: inherit;
        padding: 3px 7px;
        text-decoration: none;
        font-size: 0.85rem;
        border: 1px solid transparent;
        border-radius: 3px;
        transition: all 0.2s ease;
      }

      .filters li a:hover {
        border-color: rgba(175, 47, 47, 0.1);
      }

      .filters li a.selected {
        border-color: rgba(175, 47, 47, 0.2);
        font-weight: 500;
      }

      .clear-completed {
        position: relative;
        line-height: 20px;
        text-decoration: none;
        cursor: pointer;
        background: none;
        border: none;
        color: #777;
        font-size: 0.85rem;
        transition: color 0.2s ease;
        padding: 0;
        text-decoration: underline;
        color: #ef4444;
      }

      .clear-completed:hover {
        color: #ef4444;
      }

      .info {
        margin: 1rem auto 0;
        color: #bbb;
        font-size: 0.85rem;
        text-align: center;
        width: 550px;
        max-width: 100%;
      }

      .info p {
        line-height: 1;
        margin: 10px 0;
      }

      .info a {
        color: #aaa;
        text-decoration: none;
        font-weight: 400;
      }

      .info a:hover {
        text-decoration: underline;
      }

      @media screen and (max-width: 600px) {
        .todoapp {
          width: 90%;
          margin: 80px 0 40px 0;
        }

        .todoapp h1 {
          top: -80px;
          font-size: 60px;
        }

        .info {
          width: 90%;
        }
      }
    </style>
  </template>
}

// Embedded Template
class EmbeddedTemplate extends Component<typeof TodoMvc> {
  // Getters
  get activeTodoCount() {
    if (!Array.isArray(this.args?.model?.todos)) return 0;
    return this.args.model.todos.filter((todo) => !todo.isCompleted).length;
  }

  get completedTodoCount() {
    if (!Array.isArray(this.args?.model?.todos)) return 0;
    return this.args.model.todos.filter((todo) => todo.isCompleted).length;
  }

  get totalTodoCount() {
    if (!Array.isArray(this.args?.model?.todos)) return 0;
    return this.args.model.todos.length;
  }

  <template>
    <div class='embed-container'>
      <div class='todo-summary'>
        <h2>{{if @model.title @model.title 'Todo List'}}</h2>
        <div class='stats'>
          <div class='stat-item'>
            <div class='stat-value'>{{this.activeTodoCount}}</div>
            <div class='stat-label'>Active</div>
          </div>
          <div class='stat-item'>
            <div class='stat-value'>{{this.completedTodoCount}}</div>
            <div class='stat-label'>Completed</div>
          </div>
          <div class='stat-item'>
            <div class='stat-value'>{{this.totalTodoCount}}</div>
            <div class='stat-label'>Total</div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .embed-container {
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        overflow: hidden;
        background: white;
      }

      .todo-summary {
        padding: 1rem;
      }

      .todo-summary h2 {
        margin: 0 0 0.5rem 0;
        font-size: 1.25rem;
        color: #1f2937;
      }

      .stats {
        display: flex;
        width: 100%;
        gap: 0.85rem;
      }

      .stat-item {
        flex: 1;
        background: #f3f4f6;
        border-radius: 0.385rem;
        padding: 0.5rem;
        text-align: center;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: bold;
        color: #4b5563;
      }

      .stat-label {
        font-size: 0.85rem;
        color: #6b7280;
      }
    </style>
  </template>
}
// Todoist Card Definition
export class TodoMvc extends CardDef {
  static displayName = 'Todo Mvc';
  static icon = ListIcon;
  static prefersWideFormat = true;

  @field todos = containsMany(TodoItem);
  @field filter = contains(StringField, {
    computeVia: function () {
      return 'all';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: TodoMvc) {
      return 'TodoMVC in Boxel';
    },
  });

  @field description = contains(StringField, {
    computeVia: function (this: TodoMvc) {
      return 'A feature-complete implementation using Boxel architecture';
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
}
