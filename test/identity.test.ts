import { describe, expect, it } from 'vitest';
import { BUILTIN_ATTRIBUTE_FILTERS, BUILTIN_IDENTITY_ATTRIBUTES, identityArgs } from '../src/identity';

/** Whether `identityArgs` filters would drop `attribute="value"` (first matching rule wins). */
function ignored(args: ReturnType<typeof identityArgs>, attribute: string, value: string): boolean {
  for (const f of args.attributeFilters) {
    if (!new RegExp(f.attribute, 'i').test(attribute)) continue;
    if (f.value !== undefined && !new RegExp(f.value).test(value)) continue;
    return !f.include;
  }
  return false;
}

describe('identityArgs', () => {
  it('puts significantAttributes before the built-in ones, normalized and deduplicated', () => {
    const { identityAttributes } = identityArgs({ significantAttributes: [' Data-Action ', 'data-testid', '', 'data-uicov-id'] });
    expect(identityAttributes).toEqual(['data-action', ...BUILTIN_IDENTITY_ATTRIBUTES]);
  });

  it('defaults to the built-in attributes and filters', () => {
    const args = identityArgs({});
    expect(args.identityAttributes).toEqual(BUILTIN_IDENTITY_ATTRIBUTES);
    expect(args.attributeFilters).toHaveLength(BUILTIN_ATTRIBUTE_FILTERS.length);
  });

  it('anchors patterns and puts user filters first', () => {
    const { attributeFilters } = identityArgs({ attributeFilters: [{ attribute: 'data-.*', value: 'tmp-.*' }] });
    expect(attributeFilters[0]).toEqual({ attribute: '^(?:data-.*)$', value: '^(?:tmp-.*)$', include: false });
    expect(identityArgs({ attributeFilters: [{ attribute: 'id', include: true }] }).attributeFilters[0]).toEqual({
      attribute: '^(?:id)$',
      value: undefined,
      include: true,
    });
  });

  it('rejects invalid regular expressions with a clear error', () => {
    expect(() => identityArgs({ attributeFilters: [{ attribute: 'id', value: '(' }] })).toThrow(
      /invalid attributeFilters entry .*"value":"\("/,
    );
  });

  describe('built-in filters', () => {
    const args = identityArgs({});
    it.each([
      ['id', ':r1:'],
      ['id', 'field-:R2kq:-input'],
      ['id', '«r3»'],
      ['data-testid', 'row-550e8400-e29b-41d4-a716-446655440000'],
      ['data-row', 'deadbeefdeadbeef'],
      ['id', 'ember123'],
      ['id', 'mui-42'],
      ['id', 'radix-:r5:'],
      ['id', 'mat-input-3'],
      ['id', 'ui-id-7'],
      ['id', 'ext-gen1234'],
      ['id', 'j_id12:foo'],
      ['id', '42'],
      ['name', 'input_1699999999'],
    ])('drops generated %s="%s"', (attribute, value) => {
      expect(ignored(args, attribute, value)).toBe(true);
    });

    it.each([
      ['id', 'save'],
      ['id', 'step-2'],
      ['name', 'email'],
      ['data-testid', 'perm:read:toggle'],
      ['data-testid', 'item-42'],
    ])('keeps hand-written %s="%s"', (attribute, value) => {
      expect(ignored(args, attribute, value)).toBe(false);
    });

    it('lets an include rule override a built-in filter', () => {
      const custom = identityArgs({ attributeFilters: [{ attribute: 'id', value: 'mui-\\d+', include: true }] });
      expect(ignored(custom, 'id', 'mui-42')).toBe(false);
    });
  });
});
