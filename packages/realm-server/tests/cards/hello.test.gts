// Test fixture for verifying realm module resolution of dotted filenames.
// A request for "hello.test" (without .gts) must resolve to this file.
import { CardDef, Component } from 'https://cardstack.com/base/card-api';

export class HelloTest extends CardDef {
  static isolated = class Isolated extends Component<typeof HelloTest> {
    <template><div data-test-hello>Hello Test</div></template>
  };
}
