import type { SharedTests } from '../helpers';
import {
  registerCardReferencePrefix,
  resolveCardReference,
} from '../card-reference-resolver';

// Register test prefix mappings used across all tests in this module.
// These persist for the lifetime of the module since prefixMappings is
// module-level state, but they use unique prefixes that won't collide.
registerCardReferencePrefix(
  '@test-pkg/skills/',
  'http://localhost:9000/skills/',
);
registerCardReferencePrefix(
  '@test-pkg/catalog/',
  'http://localhost:9000/catalog/',
);

const tests = Object.freeze({
  'resolves a prefix-mapped reference': async (assert) => {
    assert.strictEqual(
      resolveCardReference('@test-pkg/skills/Skill/foo', undefined),
      'http://localhost:9000/skills/Skill/foo',
    );
  },

  'resolves a prefix-mapped reference with nested path': async (assert) => {
    assert.strictEqual(
      resolveCardReference('@test-pkg/catalog/components/Card', undefined),
      'http://localhost:9000/catalog/components/Card',
    );
  },

  'resolves a relative URL with a normal URL base': async (assert) => {
    assert.strictEqual(
      resolveCardReference(
        './foo.md',
        'http://localhost:9000/skills/Skill/bar',
      ),
      'http://localhost:9000/skills/Skill/foo.md',
    );
  },

  'resolves an absolute https:// URL when relativeTo is a prefix-form ID':
    async (assert) => {
      // Before the fix, this would throw because the WHATWG URL spec
      // validates the base even when the first arg is absolute, and
      // a prefix-form string like "@test-pkg/skills/Skill/foo" is not
      // a valid URL base.
      assert.strictEqual(
        resolveCardReference(
          'https://example.com/card/123',
          '@test-pkg/skills/Skill/foo',
        ),
        'https://example.com/card/123',
      );
    },

  'resolves an absolute http:// URL when relativeTo is a prefix-form ID':
    async (assert) => {
      assert.strictEqual(
        resolveCardReference(
          'http://localhost:4201/test/card',
          '@test-pkg/skills/Skill/foo',
        ),
        'http://localhost:4201/test/card',
      );
    },

  'resolves an absolute URL when relativeTo is undefined': async (assert) => {
    assert.strictEqual(
      resolveCardReference('https://example.com/card/123', undefined),
      'https://example.com/card/123',
    );
  },

  'resolves a relative URL when relativeTo is a prefix-form ID': async (
    assert,
  ) => {
    // Before the fix, this would throw because the prefix-form string
    // cannot be used directly as a URL base. The fix resolves the
    // prefix-form relativeTo through prefix mappings first.
    assert.strictEqual(
      resolveCardReference('./foo.md', '@test-pkg/skills/Skill/bar'),
      'http://localhost:9000/skills/Skill/foo.md',
    );
  },

  'resolves a relative URL when relativeTo is a different prefix-form ID':
    async (assert) => {
      assert.strictEqual(
        resolveCardReference(
          './Component',
          '@test-pkg/catalog/components/Card',
        ),
        'http://localhost:9000/catalog/components/Component',
      );
    },

  'throws for an unregistered bare specifier': async (assert) => {
    assert.throws(
      () => resolveCardReference('unknown-pkg/foo', undefined),
      /Cannot resolve bare package specifier "unknown-pkg\/foo"/,
    );
  },

  'resolves a root-relative URL with a normal URL base': async (assert) => {
    assert.strictEqual(
      resolveCardReference(
        '/absolute/path',
        'http://localhost:9000/skills/Skill/bar',
      ),
      'http://localhost:9000/absolute/path',
    );
  },
} as SharedTests<{}>);

export default tests;
