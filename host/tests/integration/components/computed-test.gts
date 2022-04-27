import { module, test, skip } from 'qunit';
import { renderCard } from '../../helpers/render-component';
import { contains, field, Component } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import DateCard from 'runtime-spike/lib/date';
import { setupRenderingTest } from 'ember-qunit';

module('Integration | computeds', function (hooks) {
  setupRenderingTest(hooks);

  test('can render a synchronous computed field', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
      @field lastName = contains(StringCard);
      @field fullName = contains(StringCard, function(this: Person) { return `${this.firstName} ${this.lastName}`; });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.fullName/></template>
      }
    }

    class Mango extends Person {
      static data = { firstName: 'Mango', lastName: 'Abdel-Rahman' };
    }

    await renderCard(Mango, 'isolated');

    assert.strictEqual(this.element.textContent!.trim(), 'Mango Abdel-Rahman');
  });

  test('can render a computed that consumes a nested property', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person);
      @field summary = contains(StringCard, function(this: Post) { return `${this.title} by ${this.author.firstName}`; });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.summary/></template>
      }
    }

    class FirstPost extends Post {
      static data = { title: 'First Post', author: { firstName: 'Mango' } }
    }

    await renderCard(FirstPost, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'First Post by Mango');
  });

  test('can render a computed that is a field which has a serializer', async function(assert) {
    class Person {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard,
        function(this: Person) {
          console.log("year " + this.birthdate.getFullYear());
          return new Date(this.birthdate.getFullYear() + 1, this.birthdate.getMonth(), this.birthdate.getDate());
        });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.firstBirthday/></template>
      }
    }

    class Mango extends Person {
      static data = { birthdate: '2019-10-30' }
    }

    await renderCard(Mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), 'Oct 30, 2020');
  });

  test('can render a computed that is a composite type', async function(assert) {
    class Person {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/></template>
      }
    }

    class Post {
      @field title = contains(StringCard);
      @field author = contains(Person,
        function(this: Post) {
          let person = new Person();
          person.firstName = 'Mango';
          return person;
        });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> by <@fields.author/></template>
      }
    }
    class FirstPost extends Post {
      static data = { title: 'First Post' }
    }

    await renderCard(FirstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post by Mango');
  });
});

function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}