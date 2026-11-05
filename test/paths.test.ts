import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelIndex } from '../src/server/models';
import { findWorkspaceFiles } from '../src/server/scan';
import { castType, fhirElement } from '../src/server/models/fhir';
import { parseOpt } from '../src/server/models/opt';
import { rmAttribute } from '../src/server/models/rm';
import { archetypeDefinitions, archetypeFileAt, modelReferenceAt, pathCompletions, pathDefinitions, pathHover, pathInlayHints, siteAt } from '../src/server/paths/features';
import { PathResolver, resolveFhirPath, type FhirState } from '../src/server/paths/resolver';
import { openEhrSteps } from '../src/server/paths/syntax';
import { WorkspaceIndex, type FileEntry } from '../src/server/workspace';

const CORPUS = join(__dirname, 'fixtures', 'mapping-lib-0.9.0');
const TEMPLATES = join(CORPUS, 'projects', 'org.highmed', 'KDS', 'resources', 'openehr', 'templates');
const ADL = join(__dirname, 'fixtures', 'ckm-archetypes');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const uriOf = (path: string) => pathToFileURL(path).toString();
const short = (uri: string) => uri.slice(uriOf(CORPUS).length + 1);

let index: WorkspaceIndex;
let models: ModelIndex;
let resolver: PathResolver;
const entry = (path: string): FileEntry => index.get(uriOf(join(CORPUS, path)))!;
const LAB = 'model/observation/org.openehr/laboratory_test_result.v1.yml';

/** Offset of the `nth` occurrence of `needle` in a file, plus `delta`. */
function offsetOf(e: FileEntry, needle: string, delta = 0, nth = 0): number {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = e.doc.text.indexOf(needle, at + 1);
  if (at < 0) throw new Error(`${needle} not found`);
  return at + delta;
}

beforeAll(() => {
  index = new WorkspaceIndex();
  models = new ModelIndex();
  for (const file of [...files(CORPUS), ...files(ADL)]) {
    const text = readFileSync(file, 'utf8');
    if (/\.ya?ml$/.test(file)) index.set(uriOf(file), text);
    else models.set(uriOf(file), text);
  }
  resolver = new PathResolver(index, models);
});

describe('operational templates', () => {
  it('reads nodes, labels, occurrences and archetype roots', () => {
    const template = parseOpt('x.opt', readFileSync(join(TEMPLATES, 'KDS_Laborbericht.opt'), 'utf8'))!;
    expect(template.id).toBe('KDS_Laborbericht');
    expect(template.root.rmType).toBe('COMPOSITION');
    const [observation] = template.archetypes.get('openEHR-EHR-OBSERVATION.laboratory_test_result.v1')!;
    expect(observation.kind).toBe('root');
    const history = observation.attributes.get('data')!.children[0];
    expect(history).toMatchObject({ rmType: 'HISTORY', nodeId: 'at0001' });
    const event = history.attributes.get('events')!.children[0];
    expect(event.occurrences).toEqual({ min: 0, max: undefined });
  });

  it('takes the names a template gives to nodes', () => {
    const template = parseOpt('x.opt', readFileSync(join(TEMPLATES, 'KDS_Person.opt'), 'utf8'))!;
    const [name] = template.archetypes.get('openEHR-EHR-CLUSTER.structured_name.v1')!;
    const labels = name.attributes.get('items')!.children.filter((c) => c.nodeId === 'at0005').map((c) => c.label);
    expect(labels).toContain('Familienname-Nachname');
  });

  it('ignores XML that is not a template', () => {
    expect(parseOpt('x.opt', '<archetype/>')).toBeUndefined();
    expect(parseOpt('x.opt', '<template><unclosed>')).toBeUndefined();
  });
});

describe('workspace scan', () => {
  it('finds mapping files and templates', async () => {
    const found = await findWorkspaceFiles(CORPUS);
    expect(found.mappings).toHaveLength(75);
    expect(found.models.map((f) => f.path.split('/').pop()).sort()).toContain('KDS_Laborbericht.opt');
    expect(found.models).toHaveLength(12);
  });
});

describe('reference models', () => {
  it('looks FHIR elements up through base types and accepts engine cast names', () => {
    expect(fhirElement('Condition', 'code')?.types).toEqual(['CodeableConcept']);
    expect(fhirElement('Condition', 'extension')?.types).toEqual(['Extension']);
    expect(fhirElement('Observation', 'value')?.choice).toBe(true);
    expect(castType('DateTimeType')).toBe('dateTime');
    expect(castType('Boolean')).toBe('boolean');
    expect(castType('Period')).toBe('Period');
    expect(castType('Nonsense')).toBeUndefined();
  });

  it('knows the openEHR RM attributes, also of abstract classes', () => {
    expect(rmAttribute('EVENT_CONTEXT', 'start_time')?.type).toBe('DV_DATE_TIME');
    expect(rmAttribute('DV_CODED_TEXT', 'value')?.declaredIn).toBe('DV_TEXT');
    expect(rmAttribute('ITEM_STRUCTURE', 'items')).toBeDefined();
    expect(rmAttribute('ELEMENT', 'items')).toBeUndefined();
  });

  it('splits openEHR paths with predicates', () => {
    expect(openEhrSteps("/items[openEHR-EHR-CLUSTER.address.v1 and name/value='Post/fach']/items[at0001]")).toMatchObject([
      { attribute: 'items', code: 'openEHR-EHR-CLUSTER.address.v1', name: 'Post/fach', start: 1 },
      { attribute: 'items', code: 'at0001' },
    ]);
  });
});

describe('FHIR paths', () => {
  const condition: FhirState = { known: true, types: ['Condition'], path: 'Condition' };

  it('follows elements, choices and casts', () => {
    expect(resolveFhirPath('onset.as(Period).start', 0, condition, condition, true).result).toMatchObject({ types: ['dateTime'] });
    expect(resolveFhirPath('onsetPeriod.end', 0, condition, condition, true).result).toMatchObject({ types: ['dateTime'] });
    expect(resolveFhirPath('subject.as(Patient).name', 0, condition, condition, true).result).toMatchObject({ types: ['HumanName'] });
  });

  it('reports unknown elements and impossible casts on the step', () => {
    const unknown = resolveFhirPath('$resource.code.codings', 10, condition, condition, true);
    expect(unknown.problem).toMatchObject({ start: 25, end: 32, code: 'unknown-fhir-element' });
    expect(unknown.problem?.message).toBe('`codings` is not an element of `CodeableConcept`.');
    expect(resolveFhirPath('code.as(Quantity)', 0, condition, condition, true).problem?.code).toBe('impossible-fhir-type');
    expect(resolveFhirPath('subject.as()', 0, condition, condition, true).problem?.code).toBe('unknown-fhir-type');
  });

  it('stops checking at functions it does not know', () => {
    const result = resolveFhirPath('code.coding.select(code).whatever', 0, condition, condition, true);
    expect(result.problem).toBeUndefined();
    expect(result.result.known).toBe(false);
  });
});

describe('path resolution in the 1.0.0 mapping library', () => {
  const V1 = join(__dirname, 'fixtures', 'mapping-lib-1.0.0');
  it('resolves nearly every path, and reports the ones the templates or FHIR R4 do not have', () => {
    const v1 = new WorkspaceIndex();
    const v1Models = new ModelIndex();
    for (const file of [...files(V1), ...files(ADL)]) {
      const text = readFileSync(file, 'utf8');
      if (/\.ya?ml$/.test(file)) v1.set(uriOf(file), text);
      else v1Models.set(uriOf(file), text);
    }
    const v1Resolver = new PathResolver(v1, v1Models);
    let total = 0;
    let known = 0;
    const problems: string[] = [];
    for (const e of [...v1.all()].sort((a, b) => a.uri.localeCompare(b.uri))) {
      const resolution = v1Resolver.resolve(e);
      const name = e.uri.slice(uriOf(V1).length + 1);
      for (const note of resolution.notes) problems.push(`${name} ${note.code}: ${note.message}`);
      for (const site of resolution.sites) {
        total++;
        if (site.result.known) known++;
        if (site.problem) problems.push(`${name} ${site.problem.code} ${site.value}: ${site.problem.message}`);
      }
    }
    expect(known / total).toBeGreaterThan(0.85);
    expect(problems).toMatchSnapshot();
  });
});

describe('path operators of grammar v1.0.0', () => {
  const model = (version: string) => `grammar: FHIRConnect/v${version}
type: model
metadata:
  name: OBSERVATION.operators.v1
  version: 1.0.0
spec:
  system: FHIR
  version: R4
  openEhrConfig:
    archetype: openEHR-EHR-OBSERVATION.laboratory_test_result.v1
  fhirConfig:
    structureDefinition: http://hl7.org/fhir/StructureDefinition/Encounter
mappings:
  - name: diagnosis
    with:
      fhir: $resource.diagnosis
      openehr: $archetype/data[at0001]/events[at0002]/data[at0003]/items[at0005]
    followedBy:
      mappings:
        - name: condition
          with:
            fhir: condition.reference
            openehr: $reference
          reference:
            resourceType: Condition
            mappings:
              - name: slot
                with:
                  fhir: $fhirRoot
                  openehr: ../items[at0005]
                followedBy:
                  mappings:
                    - name: use
                      with:
                        fhir: ^^.use.coding
                        openehr: $openehrRoot
`;
  const resolveModel = (version: string) => {
    const operators = new WorkspaceIndex();
    const uri = uriOf(join(CORPUS, `operators-${version}.yml`));
    operators.set(uri, model(version));
    const e = operators.get(uri)!;
    return { e, resolution: new PathResolver(operators, models).resolve(e) };
  };

  it('goes back one element of the parent path for each ^ and ../', () => {
    const { e, resolution } = resolveModel('1.0.0');
    const use = siteAt(resolution, offsetOf(e, '^^.use.coding', 4))!;
    expect(use.problem).toBeUndefined();
    expect(use.result).toMatchObject({ known: true, types: ['Coding'], elementPath: 'CodeableConcept.coding' });
    expect(use.steps[0]).toMatchObject({ text: '^^', after: { types: ['Encounter.diagnosis'] } });
    const back = siteAt(resolution, offsetOf(e, '../items[at0005]', 5))!;
    expect(back.problem).toBeUndefined();
    expect(back.result).toMatchObject({ known: true, rmTypes: ['ELEMENT'] });
    expect((back.result as { nodes: { label?: string }[] }).nodes[0].label).toBe('Test name');
  });

  it('does not know them in grammar v0.9.0', () => {
    const { resolution } = resolveModel('0.9.0');
    expect(resolution.sites.filter((s) => s.problem).map((s) => s.value)).toEqual(['../items[at0005]', '^^.use.coding']);
  });
});

describe('path resolution in the mapping library', () => {
  it('resolves nearly every path, and reports the ones the templates or FHIR R4 do not have', () => {
    let total = 0;
    let known = 0;
    const problems: string[] = [];
    for (const e of [...index.all()].sort((a, b) => a.uri.localeCompare(b.uri))) {
      const resolution = resolver.resolve(e);
      for (const note of resolution.notes) problems.push(`${short(e.uri)} ${note.code}: ${note.message}`);
      for (const site of resolution.sites) {
        total++;
        if (site.result.known) known++;
        if (site.problem) problems.push(`${short(e.uri)} ${site.problem.code} ${site.value}: ${site.problem.message}`);
      }
    }
    expect(known / total).toBeGreaterThan(0.9);
    expect(problems).toMatchSnapshot();
  });

  it('starts relative paths from the parent method', () => {
    const lab = entry(LAB);
    const site = siteAt(resolver.resolve(lab), offsetOf(lab, 'data[at0003]/items[at0005]', 2))!;
    expect(site.key).toBe('with.openehr');
    const hover = pathHover(site, offsetOf(lab, 'items[at0005]', 2))!;
    expect(hover.markdown).toContain('**Test name** · `ELEMENT`');
    expect(hover.markdown).toContain('archetype `openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl`');
    expect(hover.markdown).toContain('`openEHR-EHR-OBSERVATION.laboratory_test_result.v1/data[at0001]/events[at0002]/data[at0003]/items[at0005]`');
  });

  it('steps into the value of an ELEMENT, and the code of a coded text, as the engine does', () => {
    const qualifier = resolver.resolve(entry('model/cluster/org.openehr/problem_qualifier.v2.yml'));
    const attribute = qualifier.sites.find((s) => s.value === 'items[at0004]/code_string')!;
    expect(attribute.problem).toBeUndefined();
    expect(attribute.steps.map((s) => s.implicit)).toEqual([undefined, 'value/defining_code']);
    expect(attribute.result).toMatchObject({ known: true, rmTypes: ['String'] });
  });

  it('takes the FHIR root of a slot model from the slot that uses it', () => {
    const specimen = entry('model/cluster/org.openehr/specimen.v1.yml');
    const site = siteAt(resolver.resolve(specimen), offsetOf(specimen, '$resource.identifier', 12))!;
    expect(site.result).toMatchObject({ known: true, types: ['Identifier'], elementPath: 'Specimen.identifier' });
  });

  it('resolves extension methods inside the extended model', () => {
    const extension = entry('projects/org.highmed/KDS/person/KDS_structured_name.v1.person_name-structured_name.yml');
    const resolution = resolver.resolve(extension);
    const appended = resolution.sites.find((s) => s.value === "items[at0005 and name/value='Familienname-Nachname']")!;
    expect(appended.problem).toBeUndefined();
    expect(appended.result.known).toBe(true);
    expect(resolution.notes.map((n) => n.code)).toEqual(['unresolved-overwrite']);
  });

  it('opens the archetype at the node of a path step of a model', () => {
    const lab = entry(LAB);
    const site = siteAt(resolver.resolve(lab), offsetOf(lab, 'data[at0003]/items[at0005]', 2))!;
    const [target] = pathDefinitions(site, offsetOf(lab, 'items[at0005]', 2));
    expect(target.uri).toBe(uriOf(join(ADL, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl')));
    expect(readFileSync(join(ADL, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl'), 'utf8').slice(target.offset, target.offset + 15)).toBe('ELEMENT[at0005]');
  });

  it('opens the template of the context at the node of a path step of an extension', () => {
    const extension = entry('projects/org.highmed/KDS/laborbericht/KDS_laborbericht.yml');
    const resolution = resolver.resolve(extension);
    const site = resolution.sites.find((s) => s.side === 'openehr' && s.result.known && (s.result as { nodes: unknown[] }).nodes.length > 0)!;
    const [target] = pathDefinitions(site, site.span.end);
    expect(short(target.uri)).toBe('projects/org.highmed/KDS/resources/openehr/templates/KDS_Laborbericht.opt');
  });

  it('opens the ADL archetype at the node of a path step', () => {
    const archetypes = new ModelIndex();
    for (const file of [...files(TEMPLATES), ...files(ADL)]) archetypes.set(uriOf(file), readFileSync(file, 'utf8'));
    const lab = entry(LAB);
    const adl = readFileSync(join(ADL, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl'), 'utf8');
    const site = siteAt(new PathResolver(index, archetypes).resolve(lab), offsetOf(lab, 'data[at0003]/items[at0005]', 2))!;
    const [node] = archetypeDefinitions(site, offsetOf(lab, 'items[at0005]', 2), archetypes);
    expect(node.uri).toBe(uriOf(join(ADL, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl')));
    expect(adl.slice(node.offset, node.offset + 15)).toBe('ELEMENT[at0005]');
    const [tree] = archetypeDefinitions(site, offsetOf(lab, 'data[at0003]', 2), archetypes);
    expect(adl.slice(tree.offset, tree.offset + 17)).toBe('ITEM_TREE[at0003]');
    const [root] = archetypeFileAt(lab.doc, archetypes, offsetOf(lab, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1', 3));
    expect(adl.slice(root.offset, root.offset + 19)).toBe('OBSERVATION[at0000]');
  });

  it('shows what `with` paths resolve to as inlay hints', () => {
    const lab = entry(LAB);
    const hints = pathInlayHints(lab.doc, resolver.resolve(lab));
    const category = hints.find((h) => h.offset === offsetOf(lab, 'data[at0003]/items[at0005]"', 27));
    expect(category?.label).toBe('Test name · ELEMENT');
    expect(hints.find((h) => h.offset === offsetOf(lab, 'fhir: "category"', 16))?.label).toBe('CodeableConcept[]');
  });

  it('links a context to its template', () => {
    const context = entry('projects/org.highmed/KDS/laborbericht/KDS_laborbericht.context.yaml');
    const found = modelReferenceAt(context.doc, models, offsetOf(context, 'KDS_Laborbericht', 3))!;
    expect(found.markdown).toContain('operational template');
    expect(short(found.targets[0].uri)).toBe('projects/org.highmed/KDS/resources/openehr/templates/KDS_Laborbericht.opt');
  });
});

describe('path completion', () => {
  /** Completes in `path` after typing `typed` as the value of the key that holds `anchor`. */
  function completeAt(path: string, anchor: string, key: string, typed: string) {
    const e = entry(path);
    const valueStart = offsetOf(e, anchor) + anchor.indexOf('"') + 1;
    return pathCompletions(e.doc, resolver.resolve(e), valueStart, key, { text: typed, start: valueStart });
  }

  it('offers the template nodes below an openEHR path, with their labels', () => {
    const found = completeAt(LAB, 'openehr: "data[at0003]/items[at0005]"', 'openehr', 'data[at0003]/')!;
    const item = found.items.find((i) => i.label === 'items[at0005]')!;
    expect(item.detail).toBe('Test name · ELEMENT');
    expect(item.filterText).toContain('Test name');
    expect(found.items.some((i) => i.label === 'items[openEHR-EHR-CLUSTER.laboratory_test_analyte.v1]')).toBe(true);
  });

  it('offers RM attributes past the constrained nodes', () => {
    const found = completeAt(LAB, 'openehr: "$composition/context/start_time"', 'openehr', '$composition/context/')!;
    expect(found.items.map((i) => i.label)).toEqual(expect.arrayContaining(['start_time', 'end_time', 'setting', 'health_care_facility']));
  });

  it('offers FHIR elements and the casts of a choice element', () => {
    const found = completeAt(LAB, 'fhir: "effective.as(Period)"', 'fhir', 'effective.')!;
    expect(found.items.slice(0, 2).map((i) => i.label)).toEqual(['as(dateTime)', 'as(Period)']);
    const period = completeAt(LAB, 'fhir: "effective.as(Period)"', 'fhir', 'effective.as(Period).')!;
    expect(period.items.map((i) => i.label)).toEqual(expect.arrayContaining(['start', 'end']));
  });

  it('offers the types of a cast being typed, and the resources a Reference may point at', () => {
    const found = completeAt(LAB, 'fhir: "effective.as(Period)"', 'fhir', '$resource.encounter.as(R')!;
    expect(found).toMatchObject({ exclusive: true });
    expect(found.items.map((i) => i.label)).toEqual(['Reference', 'Encounter']);
    expect(completeAt(LAB, 'fhir: "effective.as(Period)"', 'fhir', 'effective.as(')!.items.map((i) => i.label)).toEqual(['dateTime', 'Period']);
  });
});
