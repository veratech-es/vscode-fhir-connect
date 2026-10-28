import { describe, expect, it } from 'vitest';
import { cursorContext, lineInfo } from '../src/server/cursor';

function at(text: string) {
  const lines = text.split('\n');
  const line = lines.findIndex((l) => l.includes('|'));
  const character = lines[line].indexOf('|');
  lines[line] = lines[line].replace('|', '');
  return cursorContext(lines, line, character);
}

describe('lineInfo', () => {
  it('splits dash, key and value', () => {
    expect(lineInfo('  - name: dateTime # comment')).toEqual({ dashCol: 2, keyCol: 4, key: 'name', valueCol: 10, value: 'dateTime' });
  });

  it('reads quoted keys and values with spaces', () => {
    expect(lineInfo('    "operator": one of')).toMatchObject({ keyCol: 4, key: 'operator', value: 'one of' });
  });

  it('skips blank and comment lines', () => {
    expect(lineInfo('   ')).toBeUndefined();
    expect(lineInfo('  # note')).toBeUndefined();
  });
});

describe('cursorContext', () => {
  it('finds a key inside a nested method', () => {
    const ctx = at(`mappings:
  - name: a
    with:
      fhir: x
    followedBy:
      mappings:
        - name: b
          wi|`);
    expect(ctx).toMatchObject({ kind: 'key', path: ['mappings', '-', 'followedBy', 'mappings', '-'], prefix: 'wi' });
    expect(ctx?.kind === 'key' && [...ctx.siblings]).toEqual(['name']);
  });

  it('does not leak keys of a sibling item', () => {
    const ctx = at(`mappings:
  - name: a
    with:
      fhir: x
  - name: b
    |`);
    expect(ctx).toMatchObject({ kind: 'key', path: ['mappings', '-'] });
    expect(ctx?.kind === 'key' && [...ctx.siblings]).toEqual(['name']);
  });

  it('collects sibling keys below the cursor', () => {
    const ctx = at(`metadata:
  |
  version: 1`);
    expect(ctx?.kind === 'key' && [...ctx.siblings]).toEqual(['version']);
  });

  it('handles lists that are not indented under their key', () => {
    const ctx = at(`mappings:
- name: a
  manual:
  - name: x
    fh|`);
    expect(ctx).toMatchObject({ kind: 'key', path: ['mappings', '-', 'manual', '-'] });
  });

  it('marks the first key of a new list item', () => {
    const ctx = at(`mappings:
  - na|`);
    expect(ctx).toMatchObject({ kind: 'key', path: ['mappings', '-'], newItem: true, keyCol: 4, lineIndent: 2 });
  });

  it('finds the key whose value is typed', () => {
    const ctx = at(`mappings:
  - name: a
    fhirCondition:
      operator: one|`);
    expect(ctx).toMatchObject({ kind: 'value', key: 'operator', path: ['mappings', '-', 'fhirCondition'], value: 'one' });
  });

  it('is at the root on an empty line at column 0', () => {
    expect(at(`grammar: FHIRConnect/v0.9.0
|`)).toMatchObject({ kind: 'key', path: [] });
  });
});
