import { describe, expect, it } from 'vitest';
import { GRAMMAR_VERSIONS, mappingTemplate } from '../src/client/templates';
import { hover } from '../src/server/hover';
import { documentSymbols } from '../src/server/symbols';
import { validate } from '../src/server/validation';
import { MODEL_HEADER, parse, withCursor } from './helpers';

function hoverText(text: string): string | undefined {
  const { doc, position } = withCursor(text);
  const result = hover(doc, position);
  return result && typeof result.contents === 'object' && 'value' in result.contents ? result.contents.value : undefined;
}

describe('hover', () => {
  it('documents a key for the block it is in', () => {
    expect(hoverText(`${MODEL_HEADER}
mappings:
  - name: a
    follow|edBy:
      mappings: []
`)).toContain('Child methods');
    expect(hoverText(`${MODEL_HEADER}
mappings:
  - name: a
    fhirCondition:
      tar|getRoot: x
`)).toContain('basics/Conditions.html');
  });

  it('documents variables in paths', () => {
    expect(hoverText(`${MODEL_HEADER}
mappings:
  - name: a
    with:
      openehr: $archetype/data[at0001]/items[at0077]
      fhir: $fhir|Root.onset
`)).toContain('parent mapping method');
  });

  it('has nothing for unknown keys', () => {
    expect(hoverText(`${MODEL_HEADER}
whatev|er: 1
`)).toBeUndefined();
  });
});

describe('document symbols', () => {
  it('lists methods as a tree', () => {
    const doc = parse(`${MODEL_HEADER}
mappings:
  - name: problem
    with:
      fhir: $resource
      openehr: $archetype
    followedBy:
      mappings:
        - name: onset
          with:
            fhir: onset
            openehr: data[at0001]/items[at0077]
    reference:
      resourceType: Specimen
      mappings:
        - name: specimen
          slotArchetype: CLUSTER.specimen.v1
`);
    const symbols = documentSymbols(doc, (start, end) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } }));
    const mappings = symbols.find((s) => s.name === 'mappings')!;
    const problem = mappings.children![0];
    expect(problem.name).toBe('problem');
    expect(problem.children!.map((c) => c.name)).toEqual(['onset', 'reference Specimen']);
    expect(problem.children![1].children![0]).toMatchObject({ name: 'specimen', detail: 'slot: CLUSTER.specimen.v1' });
    expect(symbols.find((s) => s.name === 'metadata')?.detail).toBe('EVALUATION.problem_diagnosis.v1');
  });
});

describe('new file templates', () => {
  /** Resolves snippet syntax the way the editor does when every placeholder keeps its default. */
  function expand(snippet: string): string {
    return snippet
      .replace(/\$\{\d+\|([^,|]*)[^}]*\}/g, '$1')
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\d+/g, 'x')
      .replace(/\\\$/g, '$');
  }

  it.each(GRAMMAR_VERSIONS.flatMap((version) => (['model', 'extension', 'context'] as const).map((kind) => [kind, version] as const)))(
    'creates a valid %s file in v%s',
    (kind, version) => {
      const doc = parse(expand(mappingTemplate(kind, 'EVALUATION.problem_diagnosis.v1', version)));
      expect(doc.fileType).toBe(kind);
      expect(doc.supportedGrammar?.version).toBe(version);
      expect(validate(doc)).toEqual([]);
    },
  );
});
