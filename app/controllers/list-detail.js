import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import toListTransition from '../transitions/to-list';
import toDetailTransition from '../transitions/to-detail';
export default class IndexController extends Controller {
  people = [
    { name: 'Alex', title: 'Developer', id: 1, bio: 'foo bar vaz' },
    { name: 'Luke', title: 'Engineering Manager', id: 2, bio: 'baz foo noo' },
  ];

  @tracked selectedPerson;
  toDetailTransition = toDetailTransition;
  toListTransition = toListTransition;
}
