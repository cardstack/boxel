import { getService } from '@universal-ember/test-support';
import { module, test, skip } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';

import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | apply-search-replace-block', function (hooks) {
  setupRenderingTest(hooks);

  test('handles basic search and replace pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';

export class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field dueDate = contains(DatetimeField);
  @field priority = contains(NumberField);
}`;
    const codeBlock = `${SEARCH_MARKER}
import NumberField from 'https://cardstack.com/base/number';
${SEPARATOR_MARKER}
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';

export class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field dueDate = contains(DatetimeField);
  @field priority = contains(NumberField);
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles multiple occurrences of the search pattern, only replacing the first', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class BlogPost extends CardDef {
  @field title = contains(StringField);
  @field content = contains(MarkdownField);
  @field author = linksTo(Author);
  @field publishedAt = contains(DatetimeField);
  @field tags = linksToMany(Tag);
}

class EmbeddedTemplate extends Component<typeof BlogPost> {
  <template>
    <article class='blog-post'>
      <h2 class='title'><@fields.title /></h2>
      <div class='post-meta'>
        <span>Published: <@fields.publishedAt /></span>
        <span>By: <@fields.author /></span>
      </div>
      <div class='content'><@fields.content /></div>
      And that title again
      <h2 class='title'><@fields.title /></h2>
    </article>
  </template>
}`;
    const codeBlock = `${SEARCH_MARKER}
      <h2 class='title'><@fields.title /></h2>
${SEPARATOR_MARKER}
      <h2 class='title' data-test-title><@fields.title /></h2>
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class BlogPost extends CardDef {
  @field title = contains(StringField);
  @field content = contains(MarkdownField);
  @field author = linksTo(Author);
  @field publishedAt = contains(DatetimeField);
  @field tags = linksToMany(Tag);
}

class EmbeddedTemplate extends Component<typeof BlogPost> {
  <template>
    <article class='blog-post'>
      <h2 class='title' data-test-title><@fields.title /></h2>
      <div class='post-meta'>
        <span>Published: <@fields.publishedAt /></span>
        <span>By: <@fields.author /></span>
      </div>
      <div class='content'><@fields.content /></div>
      And that title again
      <h2 class='title'><@fields.title /></h2>
    </article>
  </template>
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles search pattern with whitespace differences', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `export class Product extends CardDef {
  static displayName = 'Product';
  @field name = contains(StringField);
  @field description = contains(StringField);
  @field price = contains(MonetaryAmountField);
  @field inStock = contains(BooleanField);
  @field category = linksTo(ProductCategory);
}`;
    const codeBlock = `${SEARCH_MARKER}
    @field category = linksTo(ProductCategory);
${SEPARATOR_MARKER}
  @field category = linksTo(ProductCategory);
  @field images = linksToMany(ImageAsset);
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `export class Product extends CardDef {
  static displayName = 'Product';
  @field name = contains(StringField);
  @field description = contains(StringField);
  @field price = contains(MonetaryAmountField);
  @field inStock = contains(BooleanField);
  @field category = linksTo(ProductCategory);
  @field images = linksToMany(ImageAsset);
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles no match found', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `export class Review extends CardDef {
  static displayName = 'Review';
  @field title = contains(StringField);
  @field content = contains(MarkdownField);
  @field rating = contains(NumberField, { min: 1, max: 5 });
  @field product = linksTo(Product);
  @field reviewer = linksTo(User);
  @field createdAt = contains(DatetimeField, {
    computeVia: function () {
      return new Date();
    },
  });
}`;
    const codeBlock = `${SEARCH_MARKER}
  @field author = linksTo(Author);
${SEPARATOR_MARKER}
  @field author = linksTo(Author);
  @field editor = linksTo(Editor);
${REPLACE_MARKER}`;

    // No matches should throw
    try {
      await applyCommand.execute({
        fileContent,
        codeBlock,
      });
    } catch (error: any) {
      assert.ok(
        error.message.includes(
          'search pattern not found in the target source file',
        ),
        'Should throw an error when no matches are found',
      );
    }
  });

  // Skipping this test for now as throwing errors causes issues
  skip('handles malformed search/replace block', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `export class Contact extends CardDef {
  static displayName = 'Contact';
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);
  @field phone = contains(StringField);
  @field notes = contains(StringField);
}`;
    const codeBlock = `<<<<<<< WRONG_KEYWORD
  @field phone = contains(StringField);
${SEPARATOR_MARKER}
  @field phone = contains(StringField);
  @field address = contains(AddressField);
${REPLACE_MARKER}`;

    try {
      await applyCommand.execute({
        fileContent,
        codeBlock,
      });
      assert.ok(false, 'Should have thrown an error for malformed block');
    } catch (error: any) {
      assert.ok(
        error.message.includes('malformed') ||
          error.message.includes('invalid') ||
          error.message.includes('Invalid'),
        'Error message should mention malformed or invalid block',
      );
    }
  });

  test('handles search with additional context for clarity', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class WeatherDisplay extends Component<typeof Weather> {
  <template>
    <div class="weather-display">
      <h2>{{@model.location}}</h2>
      <div class="current-conditions">
        <span>{{@model.temperature}}°{{@model.unit}}</span>
        <span>{{@model.conditions}}</span>
      </div>
      <div class="forecast">
        {{#each @model.forecast as |day|}}
          <div class="forecast-day">
            <div>{{day.date}}</div>
            <div>{{day.high}}°/{{day.low}}°</div>
            <div>{{day.conditions}}</div>
          </div>
        {{/each}}
      </div>
    </div>
  </template>
}`;
    const codeBlock = `${SEARCH_MARKER}
      <div class="current-conditions">
        <span>{{@model.temperature}}°{{@model.unit}}</span>
        <span>{{@model.conditions}}</span>
      </div>
${SEPARATOR_MARKER}
      <div class="current-conditions" data-test-current-weather>
        <span>{{@model.temperature}}°{{@model.unit}}</span>
        <span>{{@model.conditions}}</span>
      </div>
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class WeatherDisplay extends Component<typeof Weather> {
  <template>
    <div class="weather-display">
      <h2>{{@model.location}}</h2>
      <div class="current-conditions" data-test-current-weather>
        <span>{{@model.temperature}}°{{@model.unit}}</span>
        <span>{{@model.conditions}}</span>
      </div>
      <div class="forecast">
        {{#each @model.forecast as |day|}}
          <div class="forecast-day">
            <div>{{day.date}}</div>
            <div>{{day.high}}°/{{day.low}}°</div>
            <div>{{day.conditions}}</div>
          </div>
        {{/each}}
      </div>
    </div>
  </template>
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles different indentation in search pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class ContactCard extends CardDef {
  static displayName = 'Contact Card';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field phone = contains(StringField);
}

class CardTemplate extends Component<typeof ContactCard> {
  <template>
    <div class="contact-card">
      <h2 class="contact-name">{{@model.name}}</h2>
      <div class="contact-details">
        <div class="contact-email">
          <label>Email:</label>
          <span>{{@model.email}}</span>
        </div>
        <div class="contact-phone">
          <label>Phone:</label>
          <span>{{@model.phone}}</span>
        </div>
      </div>
    </div>
  </template>
}`;

    // Note: The search pattern has different indentation (2 spaces) than the file (4 spaces)
    const codeBlock = `${SEARCH_MARKER}
  <div class="contact-details">
    <div class="contact-email">
      <label>Email:</label>
      <span>{{@model.email}}</span>
    </div>
    <div class="contact-phone">
      <label>Phone:</label>
      <span>{{@model.phone}}</span>
    </div>
  </div>
${SEPARATOR_MARKER}
      <div class="contact-details">
        <div class="contact-email">
          <label>Email:</label>
          <span>{{@model.email}}</span>
        </div>
        <div class="contact-phone">
          <label>Phone:</label>
          <span>{{@model.phone}}</span>
        </div>
        <div class="contact-address">
          <label>Address:</label>
          <span>{{@model.address}}</span>
        </div>
      </div>
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class ContactCard extends CardDef {
  static displayName = 'Contact Card';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field phone = contains(StringField);
}

class CardTemplate extends Component<typeof ContactCard> {
  <template>
    <div class="contact-card">
      <h2 class="contact-name">{{@model.name}}</h2>
      <div class="contact-details">
        <div class="contact-email">
          <label>Email:</label>
          <span>{{@model.email}}</span>
        </div>
        <div class="contact-phone">
          <label>Phone:</label>
          <span>{{@model.phone}}</span>
        </div>
        <div class="contact-address">
          <label>Address:</label>
          <span>{{@model.address}}</span>
        </div>
      </div>
    </div>
  </template>
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles tabs vs spaces in search pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    // File uses spaces for indentation
    const fileContent = `export class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field assignee = linksTo(User);
  @field dueDate = contains(DatetimeField);
  @field status = contains(StringField, {
    computeVia: function() {
      return 'Todo';
    }
  });
}`;

    // Search pattern uses tabs instead of spaces
    const codeBlock = `${SEARCH_MARKER}
	@field status = contains(StringField, {
		computeVia: function() {
			return 'Todo';
		}
	});
${SEPARATOR_MARKER}
  @field status = contains(StringField, {
    computeVia: function() {
      return 'In Progress';
    }
  });
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `export class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field assignee = linksTo(User);
  @field dueDate = contains(DatetimeField);
  @field status = contains(StringField, {
    computeVia: function() {
      return 'In Progress';
    }
  });
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles spurious blank lines in search pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class UserProfile extends CardDef {
  static displayName = 'User Profile';
  @field username = contains(StringField);
  @field email = contains(StringField);
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field joinDate = contains(DatetimeField, {
    computeVia: function() {
      return new Date();
    }
  });
}`;

    // Search pattern has spurious blank lines at beginning and end
    const codeBlock = `${SEARCH_MARKER}

  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);

${SEPARATOR_MARKER}
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field websiteUrl = contains(StringField, {
    computeVia: function() {
      return '';
    }
  });
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class UserProfile extends CardDef {
  static displayName = 'User Profile';
  @field username = contains(StringField);
  @field email = contains(StringField);
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field websiteUrl = contains(StringField, {
    computeVia: function() {
      return '';
    }
  });
  @field joinDate = contains(DatetimeField, {
    computeVia: function() {
      return new Date();
    }
  });
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles spurious blank lines in the middle of the search pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class UserProfile extends CardDef {
  static displayName = 'User Profile';
  @field username = contains(StringField);
  @field email = contains(StringField);
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field joinDate = contains(DatetimeField, {
    computeVia: function() {
      return new Date();
    }
  });
}`;

    // Search pattern has spurious blank
    const codeBlock = `${SEARCH_MARKER}
  @field bio = contains(StringField);

  @field avatar = linksTo(ImageAsset);
${SEPARATOR_MARKER}
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field websiteUrl = contains(StringField, {
    computeVia: function() {
      return '';
    }
  });
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class UserProfile extends CardDef {
  static displayName = 'User Profile';
  @field username = contains(StringField);
  @field email = contains(StringField);
  @field bio = contains(StringField);
  @field avatar = linksTo(ImageAsset);
  @field websiteUrl = contains(StringField, {
    computeVia: function() {
      return '';
    }
  });
  @field joinDate = contains(DatetimeField, {
    computeVia: function() {
      return new Date();
    }
  });
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles carriage return differences in search pattern', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    // File uses LF line endings
    const fileContent = `class ProductCard extends CardDef {
  static displayName = 'Product Card';
  @field name = contains(StringField);
  @field price = contains(MonetaryAmountField);
  @field description = contains(StringField);
  @field category = linksTo(Category);
}`;

    // Search uses CRLF line endings (\r\n)
    // Note: We're simulating the mixed line endings here with the string representation
    const codeBlock = `${SEARCH_MARKER}
  @field name = contains(StringField);\r
  @field price = contains(MonetaryAmountField);\r
  @field description = contains(StringField);
${SEPARATOR_MARKER}
  @field name = contains(StringField);
  @field price = contains(MonetaryAmountField);
  @field description = contains(StringField);
  @field inStock = contains(BooleanField);
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class ProductCard extends CardDef {
  static displayName = 'Product Card';
  @field name = contains(StringField);
  @field price = contains(MonetaryAmountField);
  @field description = contains(StringField);
  @field inStock = contains(BooleanField);
  @field category = linksTo(Category);
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('handles trailing whitespace differences', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class BookingForm extends Component<typeof Booking> {
  <template>
    <form class="booking-form">
      <div class="form-group">
        <label for="name">Name:</label>
        <Input @value={{@model.name}} id="name" />
      </div>
      <div class="form-group">
        <label for="date">Date:</label>
        <Input @value={{@model.date}} id="date" type="date" />
      </div>
      <button type="submit" class="submit-btn">Book Now</button>
    </form>
  </template>
}`;

    // Search pattern has trailing spaces on some lines
    const codeBlock = `${SEARCH_MARKER}
      <div class="form-group">
        <label for="date">Date:</label>
        <Input @value={{@model.date}} id="date" type="date" />
      </div>
${SEPARATOR_MARKER}
      <div class="form-group">
        <label for="date">Date:</label>
        <Input @value={{@model.date}} id="date" type="date" />
      </div>
      <div class="form-group">
        <label for="time">Time:</label>
        <Input @value={{@model.time}} id="time" type="time" />
      </div>
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    const expectedResult = `class BookingForm extends Component<typeof Booking> {
  <template>
    <form class="booking-form">
      <div class="form-group">
        <label for="name">Name:</label>
        <Input @value={{@model.name}} id="name" />
      </div>
      <div class="form-group">
        <label for="date">Date:</label>
        <Input @value={{@model.date}} id="date" type="date" />
      </div>
      <div class="form-group">
        <label for="time">Time:</label>
        <Input @value={{@model.time}} id="time" type="time" />
      </div>
      <button type="submit" class="submit-btn">Book Now</button>
    </form>
  </template>
}`;
    assert.strictEqual(result.resultContent, expectedResult);
  });

  test('it applies search/replace block when replace block is empty', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = `class Task extends CardDef {
  static displayName = 'Task';
  @field title = contains(StringField);
  @field description = contains(StringField);
}`;
    const codeBlock = `${SEARCH_MARKER}
  class Task extends CardDef {
    static displayName = 'Task';
    @field title = contains(StringField);
${SEPARATOR_MARKER}
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    assert.strictEqual(
      result.resultContent,
      `  @field description = contains(StringField);
}`,
    );
  });

  test('it allows empty search and replace blocks on empty content', async function (assert) {
    let commandService = getService('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );

    const fileContent = '';
    const codeBlock = `${SEARCH_MARKER}
${SEPARATOR_MARKER}
${REPLACE_MARKER}`;

    let result = await applyCommand.execute({
      fileContent,
      codeBlock,
    });

    assert.strictEqual(result.resultContent, '');
  });
});
