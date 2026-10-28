import { describe, expect, it } from 'vitest';
import { parseFcDocument } from '../src/server/document';
import { validate } from '../src/server/validation';
import { EXTENSION_HEADER, MODEL_HEADER, parse } from './helpers';

function problems(text: string) {
  return validate(parse(text)).map((p) => ({ code: p.code, severity: p.severity, text: text.slice(p.start, p.end), message: p.message }));
}

describe('detection', () => {
  it('recognises FHIRConnect files by their grammar line', () => {
    expect(parseFcDocument('grammar: FHIRConnect/v0.9.0\ntype: model\n')?.fileType).toBe('model');
    expect(parseFcDocument('grammar: "FHIRConnect/v0.9.0"\n')?.version).toBe('0.9.0');
    expect(parseFcDocument('name: something else\n')).toBeUndefined();
  });
});

describe('validation', () => {
  it('accepts a complete model mapping', () => {
    expect(problems(`${MODEL_HEADER}
mappings:
  - name: dateTime
    with:
      fhir: $resource.onset
      openehr: $archetype/data[at0001]/items[at0077]
    fhirCondition:
      targetRoot: $resource.onset
      operator: not empty
`)).toEqual([]);
  });

  it('reports unknown keys with a suggestion', () => {
    const [p] = problems(`${MODEL_HEADER}
mappings:
  - name: a
    withh:
      fhir: x
`);
    expect(p).toMatchObject({ code: 'unknown-key', severity: 'warning', text: 'withh' });
    expect(p.message).toContain('Did you mean `with`?');
  });

  it('reports missing required keys', () => {
    expect(problems(`grammar: FHIRConnect/v0.9.0
type: model
metadata:
  name: a
spec:
  system: FHIR
  version: R4
`)).toEqual([expect.objectContaining({ code: 'missing-key', severity: 'error', text: 'metadata', message: 'Missing required key `version` in a metadata.' })]);
  });

  it('reports values that are not allowed', () => {
    const result = problems(`${MODEL_HEADER}
mappings:
  - name: a
    unidirectional: both
    fhirCondition:
      targetRoot: $resource
      operator: equals
`);
    expect(result.map((p) => [p.code, p.text])).toEqual([
      ['invalid-value', 'both'],
      ['invalid-value', 'equals'],
    ]);
  });

  it('accepts unidirectional in any case', () => {
    expect(problems(`${MODEL_HEADER}
mappings:
  - name: a
    unidirectional: OPENEHR->FHIR
`)).toEqual([]);
  });

  it('reports values of the wrong shape', () => {
    expect(problems(`${MODEL_HEADER}
mappings:
  - name: a
    with: $resource
`)).toEqual([expect.objectContaining({ code: 'wrong-shape', severity: 'error', text: '$resource' })]);
  });

  it('reports extension keys outside extension files', () => {
    expect(problems(`${MODEL_HEADER}
mappings:
  - name: a
    extension: add
`)).toEqual([expect.objectContaining({ code: 'wrong-file-type', text: 'extension' })]);
  });

  it('requires extension methods and appendTo in extension files', () => {
    expect(problems(`${EXTENSION_HEADER}
mappings:
  - name: a
    with:
      fhir: x
  - name: b
    extension: append
`).map((p) => [p.code, p.text])).toEqual([
      ['missing-extension', 'name: a'],
      ['missing-append-to', 'name: b'],
    ]);
  });

  it('requires spec.extends in extension files', () => {
    expect(problems(`grammar: FHIRConnect/v0.9.0
type: extension
metadata:
  name: a
  version: 1
spec:
  system: FHIR
  version: R4
`).map((p) => p.message)).toEqual(['Missing required key `extends` in a spec.']);
  });

  it('reports YAML syntax errors', () => {
    expect(problems(`${MODEL_HEADER}
mappings:
  - name: a
     with: x
`)[0]).toMatchObject({ code: 'yaml-syntax', severity: 'error' });
  });

  it('only reports an unsupported grammar version', () => {
    expect(problems(`grammar: FHIRConnect/v1.0.0
type: model
whatever: true
`)).toEqual([expect.objectContaining({ code: 'unsupported-grammar', severity: 'information', text: 'grammar: FHIRConnect/v1.0.0' })]);
  });
});
