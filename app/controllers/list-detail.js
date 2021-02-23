import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import listTransition from '../transitions/list';
import detailTransition from '../transitions/detail';
export default class IndexController extends Controller {
  people = [
    { name: 'Alex', title: 'Developer', id: 1, bio: 'foo bar vaz' },
    { name: 'Luke', title: 'Engineering Manager', id: 2, bio: 'baz foo noo' },
  ];

  @tracked selectedPerson;
  detailTransition = detailTransition;
  listTransition = listTransition;
}
