import type { CardDef } from 'https://cardstack.com/base/card-api';

export type ValidateFieldPathResult =
  | {
      isValid: true;
      parts: string[];
      fieldType: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
    }
  | {
      isValid: false;
      parts: string[];
      reason: string;
    };
/**
 * Field Path Parser Utility
 *
 * Parses field paths using JavaScript-style property access notation.
 * Supports: "address.city", "tags[0]", "authors[0].name", "tags[]" (append)
 * Similar to Lodash path syntax but with custom append support.
 *
 * Examples:
 * - "firstName" → ["firstName"]
 * - "address.city" → ["address", "city"]
 * - "tags[0]" → ["tags", "[0]"]
 * - "authors[0].name" → ["authors", "[0]", "name"]
 * - "tags[]" → ["tags", "[]"] (append operation)
 * - "tags[-1]" → ["tags", "[-1]"] (append operation)
 */
export class FieldPathParser {
  /**
   * Parse a field path string into an array of path segments.
   *
   * @param fieldPath - The field path string to parse
   * @returns Array of path segments
   * @throws Error if the field path is malformed
   */
  static parseFieldPath(fieldPath: string): string[] {
    if (!fieldPath || typeof fieldPath !== 'string') {
      throw new Error('Field path must be a non-empty string');
    }

    // Handle array index syntax like "tags[1]" or "authors[0].name"
    const parts: string[] = [];
    let currentPart = '';

    for (let i = 0; i < fieldPath.length; i++) {
      const char = fieldPath[i];

      if (char === '.') {
        if (currentPart.length === 0) {
          throw new Error(`Malformed field path: "${fieldPath}"`);
        }
        parts.push(currentPart);
        currentPart = '';
      } else if (char === '[') {
        // We've hit an array index, store the field name and parse the index
        if (currentPart.length === 0) {
          throw new Error(`Malformed field path: "${fieldPath}"`);
        }
        parts.push(currentPart);

        // Find the closing bracket
        let j = i + 1;
        let indexStr = '';
        while (j < fieldPath.length && fieldPath[j] !== ']') {
          indexStr += fieldPath[j];
          j++;
        }

        if (j >= fieldPath.length) {
          throw new Error(
            `Malformed field path: "${fieldPath}" - missing closing bracket`,
          );
        }

        // Validate the index
        if (indexStr.length === 0) {
          // Empty brackets like "tags[]" means append
          parts.push('[]');
        } else if (indexStr === '-1') {
          // Special case for append
          parts.push('[-1]');
        } else {
          const index = parseInt(indexStr, 10);
          if (isNaN(index) || index < 0) {
            throw new Error(
              `Invalid array index: "${indexStr}" in path "${fieldPath}"`,
            );
          }
          parts.push(`[${index}]`);
        }

        // Skip past the closing bracket and any following dot
        i = j;
        if (i + 1 < fieldPath.length && fieldPath[i + 1] === '.') {
          i++; // Skip the dot after the closing bracket
        }
        currentPart = '';
      } else {
        currentPart += char;
      }
    }

    // Add the final part if it exists
    if (currentPart.length > 0) {
      parts.push(currentPart);
    } else if (fieldPath.endsWith('.')) {
      // Check for trailing dot
      throw new Error(`Malformed field path: "${fieldPath}"`);
    }

    if (parts.length === 0) {
      throw new Error(`Malformed field path: "${fieldPath}"`);
    }

    return parts;
  }

  /**
   * Apply a field update to an object using a parsed field path.
   *
   * @param cardData - The card data/attributes object to update (not the card instance itself)
   * @param fieldPath - The parsed field path array
   * @param value - The value to set
   * @throws Error if the operation is invalid
   */
  static applyFieldUpdate(
    cardData: {
      attributes?: Record<string, any>;
      relationships?: Record<string, any>;
    }, // Card data/attributes structure, not the CardDef instance
    fieldPath: string[],
    value: any,
    isRelationship: boolean,
  ): void {
    if (!cardData || !fieldPath || fieldPath.length === 0) {
      throw new Error('Invalid card data or field path');
    }

    if (isRelationship) {
      // For relationships, set the value in relationships using dot notation for nested paths
      const finalSegment = fieldPath[fieldPath.length - 1];
      cardData.relationships = cardData.relationships || {};
      if (finalSegment === '[]' || finalSegment === '[-1]') {
        // Append to linksToMany array
        const baseKey = FieldPathParser.buildRelationshipKey(
          fieldPath.slice(0, -1),
        );
        let maxIdx = -1;
        const regex = new RegExp(`^${baseKey}\\.(\\d+)$`);
        for (let key in cardData.relationships) {
          const match = key.match(regex);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx > maxIdx) maxIdx = idx;
          }
        }
        const nextIdx = maxIdx + 1;
        cardData.relationships[`${baseKey}.${nextIdx}`] = {
          links: { self: value.id },
        };
        return;
      }

      let relKey = FieldPathParser.buildRelationshipKey(fieldPath);
      if (Array.isArray(value)) {
        // Clear all previous entries for this linksToMany array
        const regex = new RegExp(`^${relKey}\\.(\\d+)$`);
        for (let key in cardData.relationships) {
          if (regex.test(key)) {
            delete cardData.relationships[key];
          }
        }
        for (let index = 0; index < value.length; index++) {
          const v = value[index];
          cardData.relationships[`${relKey}.${index}`] = {
            links: { self: v.id },
          };
        }
      } else {
        cardData.relationships[relKey] = { links: { self: value.id } };
      }
      return;
    }

    // Enhanced navigation: support stepping into arrays for intermediate segments
    let current = cardData.attributes || (cardData.attributes = {});
    const finalSegment = fieldPath[fieldPath.length - 1];
    const navigationDepth =
      finalSegment.startsWith('[') && finalSegment.endsWith(']')
        ? fieldPath.length - 2
        : fieldPath.length - 1;

    for (let i = 0; i < navigationDepth; i++) {
      const segment = fieldPath[i];
      if (segment.startsWith('[') && segment.endsWith(']')) {
        // Step into array at given index
        const indexStr = segment.slice(1, -1);
        if (indexStr === '' || indexStr === '-1') {
          throw new Error(
            `Cannot navigate through append operation in intermediate path: "${segment}"`,
          );
        }
        const index = parseInt(indexStr, 10);
        if (!Array.isArray(current)) {
          throw new Error(`Expected array when traversing segment ${segment}`);
        }
        // Extend array if needed
        while (current.length <= index) {
          current.push({});
        }
        current = current[index];
      } else {
        // Create nested object or array if needed
        if (!(segment in current) || current[segment] === null) {
          // Look ahead: if next segment is an array index, create array
          const next = fieldPath[i + 1];
          if (next && next.startsWith('[') && next.endsWith(']')) {
            current[segment] = [];
          } else {
            current[segment] = {};
          }
        }
        current = current[segment];
      }
    }

    // Handle the final segment (which could be an array index)
    if (finalSegment.startsWith('[') && finalSegment.endsWith(']')) {
      // This is an array index operation, get the array field name from previous segment
      if (fieldPath.length < 2) {
        throw new Error(`Invalid array index operation: "${finalSegment}"`);
      }

      const arrayFieldName = fieldPath[fieldPath.length - 2];

      // Ensure the array field exists
      if (!current[arrayFieldName]) {
        current[arrayFieldName] = [];
      } else if (!Array.isArray(current[arrayFieldName])) {
        throw new Error(`Field "${arrayFieldName}" is not an array`);
      }

      const array = current[arrayFieldName];

      // Parse the index
      const indexStr = finalSegment.slice(1, -1); // Remove [ and ]

      if (indexStr === '' || indexStr === '-1') {
        // Append operation
        array.push(value);
      } else {
        const index = parseInt(indexStr, 10);
        if (isNaN(index) || index < 0) {
          throw new Error(`Invalid array index: "${indexStr}"`);
        }

        // Allow extending arrays but with reasonable bounds check
        // Prevent extremely large indices that could cause memory issues
        if (index > array.length + 100) {
          throw new Error(
            `Array index ${index} is too far beyond current array length ${array.length}`,
          );
        }

        // Extend array with null padding if necessary
        while (array.length <= index) {
          array.push(null);
        }

        array[index] = value;
      }
    } else {
      // Simple field assignment
      current[finalSegment] = value;
    }
  }

  /**
   * Check if a path segment represents an array index.
   *
   * @param segment - The path segment to check
   * @returns True if the segment is an array index
   */
  static isArrayIndex(segment: string): boolean {
    return segment.startsWith('[') && segment.endsWith(']');
  }

  /**
   * Check if a path segment represents an append operation.
   *
   * @param segment - The path segment to check
   * @returns True if the segment is an append operation
   */
  static isAppendOperation(segment: string): boolean {
    return segment === '[]' || segment === '[-1]';
  }

  /**
   * Extract the numeric index from an array index segment.
   *
   * @param segment - The array index segment (e.g., "[0]")
   * @returns The numeric index, or null for append operations
   */
  static extractArrayIndex(segment: string): number | null {
    if (!this.isArrayIndex(segment)) {
      throw new Error(`Segment "${segment}" is not an array index`);
    }

    const indexStr = segment.slice(1, -1); // Remove [ and ]

    if (indexStr === '' || indexStr === '-1') {
      return null; // Append operation
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      throw new Error(`Invalid array index: "${indexStr}"`);
    }

    return index;
  }

  /**
   * Validate that a parsed field path is valid against a card type structure.
   *
   * @param fieldPath - The parsed field path array
   * @param cardType - The card type to validate against
   * @param cardApi - The card API module for field introspection
   * @returns Promise<boolean> indicating if the field path is valid
   */
  static async validatedFieldPath(
    fieldPath: string[],
    cardType: typeof CardDef,
    getFields: (
      cardType: typeof CardDef,
      opts?: { includeComputeds?: boolean },
    ) => Record<string, any>,
  ): Promise<ValidateFieldPathResult> {
    // Basic validation - check that the field path is not empty
    if (!fieldPath || fieldPath.length === 0) {
      return {
        isValid: false,
        parts: fieldPath,
        reason: 'Field path cannot be empty',
      };
    }

    // Use dynamic field introspection to get the actual fields from the card type
    const cardFields = getFields(cardType, { includeComputeds: true });

    const topLevelField = fieldPath[0];

    // Check if it's an array index (starts with '[')
    if (topLevelField.startsWith('[')) {
      // Array indices must follow a field name
      return {
        isValid: false,
        parts: fieldPath,
        reason: 'Array index cannot be the first segment in the path',
      };
    }

    // Validate the top-level field exists on the card type
    const field = cardFields[topLevelField];
    if (!field) {
      return {
        isValid: false,
        parts: fieldPath,
        reason: `Field "${topLevelField}" does not exist on card type "${cardType}"`,
      };
    }

    if (fieldPath.length === 1) {
      return {
        isValid: true,
        parts: fieldPath,
        fieldType: field.fieldType,
      };
    }

    // For nested paths, recursively validate the field structure
    if (fieldPath.length > 1) {
      const field = cardFields[topLevelField];

      // Disallow traversing through a relationship (linksTo/linksToMany)
      if (field.fieldType === 'linksTo') {
        return {
          isValid: false,
          parts: fieldPath,
          reason: 'Cannot traverse into linksTo relationships',
        };
      }

      // Handle array field access like "tags[0]"
      if (fieldPath[1].startsWith('[')) {
        // Validate this is actually an array field (containsMany)
        if (
          field.fieldType !== 'containsMany' &&
          field.fieldType !== 'linksToMany'
        ) {
          return {
            isValid: false,
            parts: fieldPath,
            reason: `Field "${topLevelField}" is not an array field`,
          };
        }
        if (field.fieldType === 'linksToMany' && fieldPath.length === 2) {
          return {
            isValid: true,
            parts: fieldPath,
            fieldType: 'linksToMany',
          };
        }
        if (field.fieldType === 'linksToMany' && fieldPath.length > 2) {
          // We don't support traversing into linksToMany relationships
          return {
            isValid: false,
            parts: fieldPath,
            reason: 'Cannot traverse into linksToMany relationships',
          };
        }
      }

      // For dot notation like "address.street", validate nested field structure
      if (field.fieldType === 'contains') {
        try {
          // Get the nested card type - cast to CardDef if it's a card definition
          const nestedCardType = field.card;
          if (!nestedCardType) {
            return {
              isValid: false,
              parts: fieldPath,
              reason: 'Invalid card type for contains field',
            };
          }

          // Recursively validate the remaining path against the nested type
          const remainingPath = fieldPath.slice(1);
          let result = await this.validatedFieldPath(
            remainingPath,
            nestedCardType as typeof CardDef,
            getFields,
          );
          if (result.isValid) {
            return {
              isValid: true,
              parts: fieldPath,
              fieldType: result.fieldType,
            };
          } else {
            return {
              isValid: false,
              parts: fieldPath,
              reason: result.reason,
            };
          }
        } catch (error) {
          console.error('Error during field path validation:', error);
          return {
            isValid: false,
            parts: fieldPath,
            reason:
              'Error during field path validation: ' + (error as Error).message,
          };
        }
      } else if (field.fieldType === 'containsMany') {
        fieldPath[1].startsWith('[');
        if (fieldPath.length === 2) {
          return {
            isValid: true,
            parts: fieldPath,
            fieldType: 'containsMany',
          };
        }
        if (fieldPath.length > 2) {
          const nestedCardType = field.card;
          if (!nestedCardType) {
            return {
              isValid: false,
              parts: fieldPath,
              reason: 'Invalid card type for containsMany field',
            };
          }

          // Recursively validate the remaining path against the nested type
          const remainingPath = fieldPath.slice(2);
          let result = await this.validatedFieldPath(
            remainingPath,
            nestedCardType as typeof CardDef,
            getFields,
          );
          if (result.isValid) {
            return {
              isValid: true,
              parts: fieldPath,
              fieldType: result.fieldType,
            };
          } else {
            return {
              isValid: false,
              parts: fieldPath,
              reason: result.reason,
            };
          }
        }
      }
    }
    // Did not match any valid nested structure
    return {
      isValid: false,
      parts: fieldPath,
      reason: 'Field path did not match any valid structure',
    };
  }

  static buildRelationshipKey(fieldPath: string[]): string {
    return fieldPath.join('.').replace(/[[\]]/g, '');
  }
}
