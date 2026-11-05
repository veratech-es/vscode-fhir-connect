import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { mappingContext, type ContextNode } from '../src/server/mappingContext';
import { ModelIndex } from '../src/server/models';
import { PathResolver } from '../src/server/paths/resolver';
import { WorkspaceIndex, type FileEntry } from '../src/server/workspace';

const CORPUS = join(__dirname, 'fixtures', 'mapping-lib-1.0.0');
const ADL = join(__dirname, 'fixtures', 'ckm-archetypes');
const LAB = 'model/observation/org.openehr/laboratory_test_result.v1.yml';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let input: { index: WorkspaceIndex; models: ModelIndex; resolver: PathResolver };
const entry = (path: string): FileEntry => input.index.get(pathToFileURL(join(CORPUS, path)).toString())!;

/** The tree as indented `label — description` lines. */
function lines(nodes: ContextNode[], depth = 0, max = 2): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.label}${n.description ? ` — ${n.description}` : ''}`,
    ...(depth < max ? lines(n.children ?? [], depth + 1, max) : []),
  ]);
}

beforeAll(() => {
  const index = new WorkspaceIndex();
  const models = new ModelIndex();
  for (const file of [...files(CORPUS), ...files(ADL)]) {
    const text = readFileSync(file, 'utf8');
    if (/\.ya?ml$/.test(file)) index.set(pathToFileURL(file).toString(), text);
    else models.set(pathToFileURL(file).toString(), text);
  }
  input = { index, models, resolver: new PathResolver(index, models) };
});

describe('mapping context', () => {
  it('shows the method at the cursor, its paths and the extensions that change it', () => {
    const lab = entry(LAB);
    const [method] = mappingContext(input, lab, lab.doc.text.indexOf('- name: eventParent') + 3);
    expect(lines([method], 0, 1)).toEqual([
      'eventParent — method',
      '  DiagnosticReport — FHIR · DiagnosticReport',
      '  openEHR-EHR-OBSERVATION.laboratory_test_result.v1/data[at0001]/events[at0002] — openEHR · Any event · EVENT',
      '  Changed by — 2',
    ]);
    expect(lines(method.children![2].children!)).toEqual(['eehrxf_lab_result › resultAppendToParent — append', 'KDS_laborbericht › resultAppendToParent — append']);
  });

  it('shows how a model fits in the project', () => {
    const lab = entry(LAB);
    const file = mappingContext(input, lab, 0).find((n) => n.kind === 'model')!;
    expect(lines(file.children!, 0, 0)).toEqual([
      'http://hl7.org/fhir/StructureDefinition/DiagnosticReport — structureDefinition · DiagnosticReport',
      'openEHR-EHR-OBSERVATION.laboratory_test_result.v1 — archetype · ADL',
      'Extensions — 2',
      'Contexts — 2',
    ]);
    const contexts = file.children!.find((n) => n.label === 'Contexts')!.children!;
    expect(contexts.map((c) => `${c.label} — ${c.description}`)).toEqual(['KDS_laborbericht.context — archetype, start', 'eehrxf_lab.context — archetype, start']);
  });

  it('shows the model method an extension method changes', () => {
    const kds = entry('projects/org.highmed/KDS/laborbericht/KDS_laborbericht.yml');
    const [method] = mappingContext(input, kds, kds.doc.text.indexOf('observationRecurring'));
    expect(method.label).toBe('resultAppendToParent › result › observationReference › observationRecurring');
    expect(lines(method.children!, 0, 0).slice(2)).toEqual(['CLUSTER.laboratory_test_analyte.v1 — slot · model', 'OBSERVATION.laboratory_test_result.v1 › eventParent — appends to']);
  });

  it('lists what a context loads', () => {
    const context = entry('projects/org.highmed/KDS/laborbericht/KDS_laborbericht.context.yaml');
    expect(lines(mappingContext(input, context, 0), 0, 0)).toEqual([
      'KDS_Laborbericht — template',
      'https://www.medizininformatik-initiative.de/fhir/core/modul-labor/StructureDefinition/DiagnosticReportLab — profile · not in the workspace',
      'OBSERVATION.laboratory_test_result.v1 — start · model',
      'Archetypes — 5',
      'Extensions — 2',
    ]);
  });
});
