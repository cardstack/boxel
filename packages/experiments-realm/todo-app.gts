import {
  field,
  CardDef,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Todo } from './todo';

export class TodoApp extends CardDef {
  static displayName = 'Todo App';
  @field todos = linksToMany(() => Todo);
}
