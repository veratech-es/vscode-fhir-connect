import { describe, expect, it } from 'vitest';
import { complete } from '../src/server/completion';
import { EXTENSION_HEADER, MODEL_HEADER, withCursor } from './helpers';

function labels(text: string, trigger?: string) {
  const { doc, position } = withCursor(text);
  return complete(doc, position, trigger).map((item) => item.label);
}

function item(text: string, label: string) {
  const { doc, position } = withCursor(text);
  return complete(doc, position).find((i) => i.label === label);
}

describe('key completion', () => {
  it('offers the keys of a mapping method that are not there yet', () => {
    const result = labels(`${MODEL_HEADER}
mappings:
  - name: dateTime
    |`);
    expect(result).toContain('with');
    expect(result).toContain('followedBy');
    expect(result).toContain('slotArchetype');
    expect(result).not.toContain('name');
  });

  it('only offers extension keys in extension files', () => {
    const model = labels(`${MODEL_HEADER}
mappings:
  - name: a
    |`);
    const extension = labels(`${EXTENSION_HEADER}
mappings:
  - name: a
    |`);
    expect(model).not.toContain('extension');
    expect(extension).toContain('extension');
    expect(extension).toContain('appendTo');
  });

  it('offers the root keys for the file type', () => {
    const result = labels(`grammar: FHIRConnect/v0.9.0
type: context
|`);
    expect(result).toEqual(expect.arrayContaining(['metadata', 'spec', 'context']));
    expect(result).not.toContain('mappings');
    expect(result).not.toContain('grammar');
  });

  it('inserts a snippet aligned with a key that follows a list dash', () => {
    const with_ = item(`${MODEL_HEADER}
mappings:
  - wi|`, 'with');
    expect(with_?.textEdit?.newText).toBe('with:\n    fhir: ${1:\\$resource}\n    openehr: ${2:\\$archetype}');
  });

  it('offers a whole method on a new list item', () => {
    const { doc, position } = withCursor(`${MODEL_HEADER}
mappings:
  - |`);
    const first = complete(doc, position, ' ')[0];
    expect(first.label).toBe('mapping method');
    expect(first.textEdit?.newText).toBe('name: ${1:name}\n    with:\n      fhir: ${2:\\$resource}\n      openehr: ${3:\\$archetype}');
  });

  it('offers a new list item under a list key', () => {
    expect(labels(`${MODEL_HEADER}
mappings:
  |`)).toEqual(['- mapping method']);
  });

  it('stays quiet while indenting', () => {
    expect(labels(`${MODEL_HEADER}
mappings:
  - name: a
    |`, ' ')).toEqual([]);
  });

  it('offers condition keys', () => {
    expect(labels(`${MODEL_HEADER}
mappings:
  - name: a
    fhirCondition:
      targetRoot: $resource
      |`)).toEqual(['operator', 'targetAttribute', 'targetAttributes', 'criteria', 'criterias', 'identifying']);
  });
});

describe('value completion', () => {
  it('offers operators', () => {
    expect(labels(`${MODEL_HEADER}
mappings:
  - name: a
    fhirCondition:
      operator: |`)).toEqual(['one of', 'not of', 'empty', 'not empty', 'type']);
  });

  it('replaces the whole typed value', () => {
    const one = item(`${MODEL_HEADER}
mappings:
  - name: a
    fhirCondition:
      operator: one|`, 'one of');
    expect(one?.textEdit).toEqual({ range: { start: { line: 16, character: 16 }, end: { line: 16, character: 19 } }, newText: 'one of' });
  });

  it('offers variables for paths', () => {
    expect(labels(`${MODEL_HEADER}
mappings:
  - name: a
    with:
      openehr: |`)).toEqual(['$archetype', '$openehrRoot', '$composition', '$reference']);
  });

  it('offers file types and the grammar', () => {
    expect(labels(`grammar: FHIRConnect/v0.9.0
type: |`)).toEqual(['model', 'extension', 'context']);
    expect(labels(`grammar: |FHIRConnect/v0.9.0`)).toEqual(['FHIRConnect/v0.9.0']);
  });

  it('offers extension methods', () => {
    expect(labels(`${EXTENSION_HEADER}
mappings:
  - name: a
    extension: |`)).toEqual(['add', 'append', 'overwrite']);
  });
});
