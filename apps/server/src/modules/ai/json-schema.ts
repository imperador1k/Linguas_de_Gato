/**
 * Small builders for strict Structured Outputs schemas: every property
 * required, `additionalProperties: false`, optional values as
 * `["type", "null"]`. Length limits are enforced by Zod afterwards (strict
 * mode doesn't document support for them).
 */
export type JsonSchema = Record<string, unknown>;

export const string: JsonSchema = { type: 'string' };
export const integer: JsonSchema = { type: 'integer' };
export const boolean: JsonSchema = { type: 'boolean' };
export const stringArray: JsonSchema = { type: 'array', items: string };
export const nullableString: JsonSchema = { type: ['string', 'null'] };
export const nullableInteger: JsonSchema = { type: ['integer', 'null'] };
export const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] });
export const arrayOf = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
export const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
