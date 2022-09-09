import { module, test, skip } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import stringify from 'fast-json-stable-stringify'
import { fillIn } from '@ember/test-helpers';
import { renderCard } from '../../helpers/render-component';
import parseISO from 'date-fns/parseISO';
import { p, cleanWhiteSpace,  } from '../../helpers';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");
let integer: typeof import ("https://cardstack.com/base/integer");
let date: typeof import ("https://cardstack.com/base/date");
let datetime: typeof import ("https://cardstack.com/base/datetime");
let cardRef: typeof import ("https://cardstack.com/base/card-ref");

module('Integration | serialization', function (hooks) {
  setupRenderingTest(hooks);
  const realmURL = `https://test-realm/`;

  hooks.before(async function () {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    Loader.disableNativeImport(true);

    cardApi = await Loader.import(`${baseRealm.url}card-api`);
    string = await Loader.import(`${baseRealm.url}string`);
    integer = await Loader.import(`${baseRealm.url}integer`);
    date = await Loader.import(`${baseRealm.url}date`);
    datetime = await Loader.import(`${baseRealm.url}datetime`);
    cardRef = await Loader.import(`${baseRealm.url}card-ref`);
  });

  test('can deserialize field', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> created <@fields.created/> published <@fields.published /></template>
      }
    }

    // initialize card data as serialized to force us to deserialize instead of using cached data
    let firstPost = await createFromSerialized(Post, { title: 'First Post', created: '2022-04-22', published: '2022-04-27T16:02' });
    await renderCard(firstPost, 'isolated');

    // the template value 'Apr 22, 2022' can only be realized when the card has
    // correctly deserialized it's static data property
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post created Apr 22, 2022 published Apr 27, 2022, 4:02 PM');
  });

  test('deserialized card ref fields are not strict equal to serialized card ref', async function(assert) {
    let {field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test-ref><@fields.ref/></div></template>
      }
    }

    let ref = { module: `http://localhost:4201/test/person`, name: 'Person' };
    let driver = await createFromSerialized(DriverCard, { ref });
    assert.ok(driver.ref !== ref, 'the card ref value is not strict equals to its serialized counter part');
    assert.deepEqual(driver.ref, ref, 'the card ref value is deep equal to its serialized counter part')
  });

  test('serialized card ref fields are not strict equal to their deserialized card ref values', async function(assert) {
    let {field, contains, Card, Component, serializedGet } = cardApi;
    let { default: CardRefCard } = cardRef;
    class DriverCard extends Card {
      @field ref = contains(CardRefCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><div data-test-ref><@fields.ref/></div></template>
      }
    }

    let ref = { module: `http://localhost:4201/test/person`, name: 'Person' };
    let driver = new DriverCard({ ref });
    let serializedRef = serializedGet(driver, 'ref');
    assert.ok(serializedRef !== ref, 'the card ref value is not strict equals to its serialized counter part');
    assert.deepEqual(serializedRef, ref, 'the card ref value is deep equal to its serialized counter part')
  });

  test('can serialize field', async function(assert) {
    let { field, contains, Card, Component, serializedGet } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>created {{serializedGet @model 'created'}}, published {{serializedGet @model 'published'}}</template>
      }
    }

    // initialize card data as deserialized to force us to serialize instead of using cached data
    let firstPost =  new Post({ title: 'First Post', created: p('2022-04-22'), published: parseISO('2022-04-27T16:30+00:00') });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'created 2022-04-22, published 2022-04-27T16:30:00.000Z');
  });

  test('can deserialize a date field with null value', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.title/> created <@fields.created/> published <@fields.published /></template>
      }
    }

    let firstPost = await createFromSerialized(Post, { title: 'First Post', created: null, published: null });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'First Post created [no date] published [no date-time]');
  });

  test('can serialize a date field with null value', async function(assert) {
    function asString(a: unknown): string {
      return String(a);
    }

    let { field, contains, Card, Component, serializedGet } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          created {{asString (serializedGet @model 'created')}},
          published {{asString (serializedGet @model 'published')}}
        </template>
      }
    }

    let firstPost =  new Post({ title: 'First Post', created: null, published: null });
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'created null, published null');
  });

  test('can deserialize a nested field', async function(assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>birthdate <@fields.author.birthdate/> last login <@fields.author.lastLogin/></template>
      }
    }

    let firstPost = await createFromSerialized(Post,
      {
        title: 'First Post',
        "author.firstName": 'Mango',
        "author.birthdate": '2019-10-30',
        "author.lastLogin": '2022-04-27T16:58'
      }
    );
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'birthdate Oct 30, 2019 last login Apr 27, 2022, 4:58 PM');
  });

  test('can deserialize a composite field', async function(assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName/> born on: <@fields.birthdate/> last logged in: <@fields.lastLogin/></template>
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.author/></template>
      }
    }

    let firstPost = await createFromSerialized(Post,
      {
        title: 'First Post',
        "author.firstName": 'Mango',
        "author.birthdate": '2019-10-30',
        "author.lastLogin": '2022-04-27T17:00'
      }
    );
    await renderCard(firstPost, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Mango born on: Oct 30, 2019 last logged in: Apr 27, 2022, 5:00 PM');
  });

  skip('can serialize a composite field', async function(assert) {
    let { field, contains, serializedGet, Card } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Post extends Card {
      @field author = contains(Person);
    }

    let firstPost = new Post({
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        lastLogin: parseISO('2022-04-27T16:30+00:00')
      })
    });

    assert.deepEqual(serializedGet(firstPost, 'author'), {
      attributes: {
        birthdate: "2019-10-30",
        firstName:"Mango",
        lastLogin:"2022-04-27T16:30:00.000Z",
      }
    });
  });


  skip('can serialize a polymorphic composite field', async function(assert) {
    let { field, contains, serializedGet, Card } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
      @field lastLogin = contains(DatetimeCard);
    }

    class Employee extends Person {
      @field department = contains(StringCard);
    }

    class Post extends Card {
      @field author = contains(Person);
    }

    // this is only theoretic right now, but I'm assuming our upcoming loader
    // object identity tracking will be able to identify these classes after this
    Loader.shimModule(`${realmURL}test-cards`, { Person, Employee, Post });
    let module = await Loader.import<any>(`${realmURL}test-cards`);
    module.Post;
    module.Employee;
    module.Person;

    let firstPost = new Post({
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        lastLogin: parseISO('2022-04-27T16:30+00:00'),
        department: 'wagging'
      })
    });

    assert.deepEqual(serializedGet(firstPost, 'author'), {
      attributes: {
        birthdate: "2019-10-30",
        firstName:"Mango",
        lastLogin:"2022-04-27T16:30:00.000Z",
        department: 'wagging'
      },
      meta: {
        adoptsFrom: {
          module: `${realmURL}test-cards`,
          name: 'Employee',
        },
      }
    });
  });

  test('can serialize a composite field that has been edited', async function(assert) {
    let { field, contains, serializeCard, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: IntegerCard} = integer;
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field reviews = contains(IntegerCard);
      @field author = contains(Person);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <fieldset>
            <label data-test-field="title">Title <@fields.title /></label>
            <label data-test-field="reviews">Reviews <@fields.reviews /></label>
            <label data-test-field="author">Author <@fields.author /></label>
          </fieldset>

          <div data-test-output="title">{{@model.title}}</div>
          <div data-test-output="reviews">{{@model.reviews}}</div>
          <div data-test-output="author.firstName">{{@model.author.firstName}}</div>
        </template>
      }
    }

    let helloWorld = await createFromSerialized(Post,
      {
        title: 'First Post',
        reviews: 1,
        "author.firstName": 'Arthur'
      }
    );
    await renderCard(helloWorld, 'edit');
    await fillIn('[data-test-field="author"] input', 'Carl Stack');

    assert.deepEqual(
      serializeCard(helloWorld), {
        type: 'card',
        attributes: {
          title: 'First Post',
          reviews: 1,
          "author.firstName": 'Carl Stack'
        }
      }
    )
  });

  test('can serialize a computed field', async function(assert) {
    let { field, contains, serializedGet, Card, Component } = cardApi;
    let { default: DateCard } = date;
    class Person extends Card {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard, { computeVia:
        function(this: Person) {
          return new Date(this.birthdate.getFullYear() + 1, this.birthdate.getMonth(), this.birthdate.getDate());
        }
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{serializedGet @model 'firstBirthday'}}</template>
      }
    }

    let mango =  new Person({ birthdate: p('2019-10-30') });
    await renderCard(mango, 'isolated');
    assert.strictEqual(this.element.textContent!.trim(), '2020-10-30');
  });

  test('can deserialize a containsMany field', async function(assert) {
    let { field, containsMany, Card, Component, createFromSerialized } = cardApi;
    let { default: DateCard } = date;
    class Schedule extends Card {
      @field dates = containsMany(DateCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.dates/></template>
      }
    }

    let classSchedule = await createFromSerialized(Schedule, { dates: ['2022-4-1', '2022-4-4'] });
    await renderCard(classSchedule, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Apr 1, 2022 Apr 4, 2022');
  });

  test("can deserialize a containsMany's nested field", async function(assert) {
    let { field, contains, containsMany, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Appointment extends Card {
      @field date = contains(DateCard);
      @field location = contains(StringCard);
      @field title = contains(StringCard);
      static embedded = class Isolated extends Component<typeof this> {
        <template><@fields.title/> on <@fields.date/> at <@fields.location/></template>
      }
    }
    class Schedule extends Card {
      @field appointments = containsMany(Appointment);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.appointments/></template>
      }
    }
    let classSchedule = await createFromSerialized(Schedule,
      {
        appointments: [
          { date: '2022-4-1', location: 'Room 332', title: 'Biology' },
          { date: '2022-4-4', location: 'Room 102', title: 'Civics' }
        ]
      }
    );
    await renderCard(classSchedule, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'Biology on Apr 1, 2022 at Room 332 Civics on Apr 4, 2022 at Room 102');
  });

  test('can serialize a containsMany field', async function(assert) {
    let { field, containsMany, serializedGet, Card, Component } = cardApi;
    let { default: DateCard } = date;
    class Schedule extends Card {
      @field dates = containsMany(DateCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{stringify (serializedGet @model 'dates')}}</template>
      }
    }
    let classSchedule = new Schedule({ dates: [p('2022-4-1'), p('2022-4-4')] });
    await renderCard(classSchedule, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), '["2022-04-01","2022-04-04"]');
  });

  test("can serialize a containsMany's nested field", async function(assert) {
    let { field, contains, containsMany, serializedGet, Card, Component } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Appointment extends Card {
      @field date = contains(DateCard);
      @field location = contains(StringCard);
      @field title = contains(StringCard);
    }
    class Schedule extends Card {
      @field appointments = containsMany(Appointment);
      static isolated = class Isolated extends Component<typeof this> {
        <template>{{stringify (serializedGet @model 'appointments')}}</template>
      }
    }
    let classSchedule = new Schedule({ appointments: [
      new Appointment({ date: p('2022-4-1'), location: 'Room 332', title: 'Biology' }),
      new Appointment({ date: p('2022-4-4'), location: 'Room 102', title: 'Civics' }),
    ]});
    await renderCard(classSchedule, 'isolated');
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), '[{"date":"2022-04-01","location":"Room 332","title":"Biology"},{"date":"2022-04-04","location":"Room 102","title":"Civics"}]');
  });

  test('can serialize a card with primitive fields', async function (assert) {
    let { field, contains, serializeCard, Card, } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    let { default: DatetimeCard } = datetime;
    class Post extends Card {
      @field title = contains(StringCard);
      @field created = contains(DateCard);
      @field published = contains(DatetimeCard);
    }
    let firstPost = new Post({ title: 'First Post', created: p('2022-04-22'), published: parseISO('2022-04-27T16:30+00:00') });
    await renderCard(firstPost, 'isolated');
    let payload = serializeCard(firstPost);
    assert.deepEqual(
      payload as any,
      {
        type: 'card',
        attributes: {
          title: 'First Post',
          created: '2022-04-22',
          published: '2022-04-27T16:30:00.000Z',
        },
      },
      'A model can be serialized once instantiated'
    );
  });

  test('can serialize a card with composite field', async function (assert) {
    let { field, contains, serializeCard, Card, } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;
    class Animal extends Card {
      @field species = contains(StringCard);
    }
    class Person extends Animal {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }
    let firstPost = new Post({
      title: 'First Post',
      author: new Person({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        species: 'canis familiaris'
      })
    });
    await renderCard(firstPost, 'isolated');
    let payload = serializeCard(firstPost);
    assert.deepEqual(
      payload as any,
      {
        type: 'card',
        attributes: {
          title: 'First Post',
          "author.firstName": 'Mango',
          "author.birthdate": '2019-10-30',
          "author.species": 'canis familiaris',
        },
      }
    );
  });

  skip('can serialize a card whose composite field value uses a card that adopts from the composite field card', async function (assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;
    let { default: DateCard } = date;

    class Person extends Card {
      @field firstName = contains(StringCard);
      @field birthdate = contains(DateCard);
    }

    class Employee extends Person {
      @field department = contains(StringCard);
    }

    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    Loader.shimModule(`${realmURL}test-cards`, { Person, Employee, Post });

    let firstPost = new Post({
      title: 'First Post',
      author: new Employee({
        firstName: 'Mango',
        birthdate: p('2019-10-30'),
        department: 'wagging'
      })
    });
    await renderCard(firstPost, 'isolated');
    let payload = serializeCard(firstPost, { 
      adoptsFrom: { 
        module: `./test-cards`, 
        name: 'Post',
      }
    });
    assert.deepEqual(
      payload as any,
      {
        type: 'card',
        attributes: {
          title: 'First Post',
          "author.firstName": 'Mango',
          "author.birthdate": '2019-10-30',
          "author.department": 'wagging',
        },
        meta: {
          adoptsFrom: { 
            module: `./test-cards`, 
            name: 'Post',
          },
          fields: {
            author: {
              adoptsFrom: {
                module: `./test-cards`, 
                name: 'Employee',
              }
            }
          }
        }
      }
    );

    let post2 = await createFromSerialized<typeof Post>(payload, new URL(realmURL)); // success is not blowing up
    assert.strictEqual(post2.author.firstName, 'Mango');
    let { author } = post2;
    if (author instanceof Employee) {
      assert.strictEqual(author.department, 'wagging');
    } else {
      assert.ok(false, 'Not an employee');
    }
  });

  test('can deserialize a card from a resource object', async function(assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    Loader.shimModule(`${realmURL}person`, { Person });

    let person = await createFromSerialized({
      type: 'card',
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: "./person",
          name: "Person"
        }
      }
    }, new URL(realmURL)) as Person;
    assert.strictEqual(person.firstName, 'Mango');
    assert.deepEqual(serializeCard(person, {
      adoptsFrom: {
        module: "./person",
        name: "Person"
      }
    }), {
      type: 'card',
      attributes: {
        firstName: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: "./person",
          name: "Person"
        }
      }
    }, 'card serialization is correct')
  });

  test('can deserialize a card from a resource object with composite fields', async function(assert) {
    let { field, contains, serializeCard, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    Loader.shimModule(`${realmURL}person`, { Person });
    Loader.shimModule(`${realmURL}post`, { Post });

    let post = await createFromSerialized<typeof Post>({
      type: 'card',
      attributes: {
        title: "Things I Want to Chew",
        "author.firstName": 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: "./post",
          name: "Post"
        }
      }
    }, new URL(realmURL));
    assert.strictEqual(post.title, 'Things I Want to Chew');
    assert.strictEqual(post.author.firstName, 'Mango');
    assert.deepEqual(serializeCard(post, {
      adoptsFrom: {
        module: "./post",
        name: "Post"
      }
    }), {
      type: 'card',
      attributes: {
        title: "Things I Want to Chew",
        "author.firstName": 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: "./post",
          name: "Post"
        }
      }
    }, 'card serialization is correct')
  });

  test('can deserialize a card with contains many of a compound card field', async function(assert) {
    let { field, contains, containsMany, serializeCard, Card, createFromSerialized } = cardApi;
    let { default: StringCard } = string;

    class Person extends Card {
      @field firstName = contains(StringCard);
    }
    class Post extends Card {
      @field title = contains(StringCard);
      @field author = contains(Person);
    }
    class Blog extends Card {
      @field posts = containsMany(Post);
    }
    Loader.shimModule(`${realmURL}person`, { Person });
    Loader.shimModule(`${realmURL}post`, { Post });
    Loader.shimModule(`${realmURL}blog`, { Blog });


    let blog = await createFromSerialized({
      type: 'card',
      attributes: {
        posts: [{
          title: "Things I Want to Chew",
          "author.firstName": 'Mango',
        },{
          title: "When Mango Steals My Bone",
          "author.firstName": 'Van Gogh',
        }]
      },
      meta: {
        adoptsFrom: {
          module: "./blog",
          name: "Blog"
        }
      }
    }, new URL(realmURL)) as Blog;
    let posts = blog.posts;
    assert.strictEqual(posts.length, 2, 'number of posts is correct');
    assert.strictEqual(posts[0].title, 'Things I Want to Chew');
    assert.strictEqual(posts[0].author.firstName, 'Mango');
    assert.strictEqual(posts[1].title, 'When Mango Steals My Bone');
    assert.strictEqual(posts[1].author.firstName, 'Van Gogh');

    assert.deepEqual(serializeCard(blog, {
      adoptsFrom: {
        module: "./blog",
        name: "Blog"
      }
    }), {
      type: 'card',
      attributes: {
        posts: [{
          title: "Things I Want to Chew",
          "author.firstName": 'Mango',
        },{
          title: "When Mango Steals My Bone",
          "author.firstName": 'Van Gogh',
        }]
      },
      meta: {
        adoptsFrom: {
          module: "./blog",
          name: "Blog"
        }
      }
    }, 'card serialization is correct')
  });


  test('can serialize a card with computed field', async function (assert) {
    let { field, contains, serializeCard, Card, } = cardApi;
    let { default: DateCard } = date;
    class Person extends Card {
      @field birthdate = contains(DateCard);
      @field firstBirthday = contains(DateCard, { computeVia:
        function(this: Person) {
          return new Date(this.birthdate.getFullYear() + 1, this.birthdate.getMonth(), this.birthdate.getDate());
        }
      });
    }
    let mango = new Person({ birthdate: p('2019-10-30') });
    await renderCard(mango, 'isolated');
    let withoutComputeds = serializeCard(mango);
    assert.deepEqual(
      withoutComputeds as any,
      {
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
        },
      }
    );

    let withComputeds = serializeCard(mango, { includeComputeds: true });
    assert.deepEqual(
      withComputeds as any,
      {
        type: 'card',
        attributes: {
          birthdate: '2019-10-30',
          firstBirthday: '2020-10-30',
        },
      }
    );
  });
});
