import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import listDetailTransition from '../transitions/list-detail';

class Person {
  name: string;
  title: string;
  id: string;
  bio: string;

  constructor(name: string, title: string, id: string, bio: string) {
    this.name = name;
    this.title = title;
    this.id = id;
    this.bio = bio;
  }
}
export default class IndexController extends Controller {
  people = [
    new Person('Alex', 'Developer', '1', 'foo bar vaz'),
    new Person('Luke', 'Engineering Manager', '2', 'baz foo noo'),
  ];

  @tracked selectedPerson: Person | null = null;
  listDetailTransition = listDetailTransition;
}
