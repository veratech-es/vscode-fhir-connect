import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ModelIndex } from '../src/server/models';
import { parseAdl } from '../src/server/models/adl';
import type { OptNode } from '../src/server/models/opt';
import { pathCompletions, pathHover, siteAt } from '../src/server/paths/features';
import { PathResolver } from '../src/server/paths/resolver';
import { WorkspaceIndex } from '../src/server/workspace';

const FIXTURES = join(__dirname, 'fixtures');
const CKM = join(FIXTURES, 'ckm-archetypes');
const XDS_ADL = join(FIXTURES, 'catsalut-archetypes', 'openEHR-EHR-CLUSTER.xds_metadata.v0.adl');
// a template that holds the international openEHR-EHR-CLUSTER.xds_metadata.v0, where Health care facility type is at0007
const EHDS_LAB = join(FIXTURES, 'mapping-lib-1.0.0', 'projects', 'org.openehr', 'EEHRxF', 'lab', 'resources', 'openehr', 'templates', 'EHDS - Laboratory report.opt');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const uriOf = (path: string) => pathToFileURL(path).toString();

const XDS_MODEL = `grammar: FHIRConnect/v1.0.0
type: model
metadata:
  name: CatSalut_XDS
  version: 0.0.1
spec:
  system: FHIR
  version: R4
  openEhrConfig:
    archetype: openEHR-EHR-CLUSTER.xds_metadata.v0
    revision: 1.0.0
  fhirConfig:
    structureDefinition: http://hl7.org/fhir/StructureDefinition/DocumentReference

mappings:
  - name: confidentialityCode
    with:
      fhir: $resource.securityLabel
      openehr: $archetype/items[at0004]
  - name: facilityType
    with:
      fhir: $resource.context.facilityType
      openehr: $archetype/items[at0032]
  - name: oldFacilityType
    with:
      fhir: $resource.context.facilityType
      openehr: $archetype/items[at0007]
`;

/** A workspace with the XDS model mapping and the given model files. */
function workspace(modelFiles: string[]) {
  const index = new WorkspaceIndex();
  const models = new ModelIndex();
  for (const file of modelFiles) models.set(uriOf(file), readFileSync(file, 'utf8'));
  const uri = uriOf(join(FIXTURES, 'xds.model.yml'));
  index.set(uri, XDS_MODEL);
  const entry = index.get(uri)!;
  return { entry, resolution: new PathResolver(index, models).resolve(entry) };
}

describe('ADL archetypes', () => {
  it('reads the definition with node ids as written, in their order, with the terms of the original language', () => {
    const archetype = parseAdl('x.adl', readFileSync(XDS_ADL, 'utf8'))!;
    const root = archetype.definition!.root;
    expect(root).toMatchObject({ kind: 'root', rmType: 'CLUSTER', archetypeId: 'openEHR-EHR-CLUSTER.xds_metadata.v0', label: 'XDS Metadata' });
    const items = root.attributes.get('items')!;
    expect(items.multiple).toBe(true);
    expect(items.children.map((c) => c.nodeId)).toEqual(['at0001', 'at0002', 'at0003', 'at0004', 'at0032', 'at0009', 'at0011', 'at0010']);
    const facility = items.children[4];
    expect(facility).toMatchObject({ rmType: 'ELEMENT', label: 'Health care facility type', occurrences: { min: 0, max: 1 } });
    expect(items.children[5].attributes.get('value')!.children.map((c) => c.rmType)).toEqual(['DV_TEXT', 'DV_CODED_TEXT']);
    expect(items.children[6].occurrences).toEqual({ min: 0, max: undefined });
  });

  it('reads slots, internal references and domain types', () => {
    const lab = parseAdl('x.adl', readFileSync(join(CKM, 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1.adl'), 'utf8'))!.definition!;
    const data = lab.root.attributes.get('data')!.children[0].attributes.get('events')!.children[0].attributes.get('data')!.children[0];
    const slot = data.attributes.get('items')!.children.find((c) => c.nodeId === 'at0097')!;
    expect(slot).toMatchObject({ kind: 'slot', rmType: 'CLUSTER', label: 'Test result' });
    expect(slot.includes![0]).toContain('openEHR-EHR-CLUSTER\\.laboratory_test_analyte(-[a-zA-Z0-9_]+)*\\.v1');
    const dosage = parseAdl('x.adl', readFileSync(join(CKM, 'openEHR-EHR-CLUSTER.dosage.v2.adl'), 'utf8'))!.definition!;
    const quantities: string[] = [];
    const visit = (n: OptNode) => {
      if (n.rmType === 'DV_QUANTITY') quantities.push(n.owner!.archetypeId!);
      for (const a of n.attributes.values()) a.children.forEach(visit);
    };
    visit(dosage.root);
    expect(quantities.length).toBeGreaterThan(0);
  });

  it('has every node that the templates of the mapping libraries take from the same archetypes', () => {
    const models = new ModelIndex();
    const templates = [...files(join(FIXTURES, 'mapping-lib-0.9.0')), ...files(join(FIXTURES, 'mapping-lib-1.0.0'))].filter((f) => f.endsWith('.opt'));
    for (const file of [...templates, ...files(CKM)]) models.set(uriOf(file), readFileSync(file, 'utf8'));
    let compared = 0;
    const missing: string[] = [];
    for (const template of models.allTemplates()) {
      for (const [id, roots] of template.archetypes) {
        const [adl] = models.adlRoots(id);
        if (!adl) continue;
        for (const root of roots) {
          const walk = (node: OptNode, match: OptNode | undefined, path: string) => {
            for (const [name, attribute] of node.attributes) {
              for (const child of attribute.children) {
                if (child.owner !== root || child.kind === 'root' || !child.nodeId) continue;
                const step = `${path}/${name}[${child.nodeId}]`;
                const found = match?.attributes.get(name)?.children.find((c) => c.nodeId === child.nodeId);
                compared++;
                if (!found) missing.push(`${id}${step} (${template.id})`);
                walk(child, found, step);
              }
            }
          };
          walk(root, adl, '');
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(missing).toEqual([]);
  });
});

describe('model mappings resolve against the ADL archetype, not templates', () => {
  it('completes and checks the node codes of the archetype even when a template has another version of it', () => {
    const { entry, resolution } = workspace([XDS_ADL, EHDS_LAB]);
    const facility = resolution.sites.find((s) => s.value === '$archetype/items[at0032]')!;
    expect(facility.problem).toBeUndefined();
    expect(pathHover(facility, facility.span.end - 2)!.markdown).toContain('**Health care facility type** · `ELEMENT`');
    const old = resolution.sites.find((s) => s.value === '$archetype/items[at0007]')!;
    expect(old.problem?.message).toBe(
      'No node `[at0007]` in `items` of XDS Metadata (CLUSTER) in the archetype `openEHR-EHR-CLUSTER.xds_metadata.v0`.',
    );

    const start = facility.span.start;
    const found = pathCompletions(entry.doc, resolution, start, 'openehr', { text: '$archetype/', start })!;
    const items = found.items.filter((i) => i.label.startsWith('items['));
    expect(items.map((i) => i.label)).toEqual(['items[at0001]', 'items[at0002]', 'items[at0003]', 'items[at0004]', 'items[at0032]', 'items[at0009]', 'items[at0011]', 'items[at0010]']);
    expect(items[4].detail).toBe('Health care facility type · ELEMENT');
  });

  it('does not check the openEHR paths of a model whose archetype is only in templates', () => {
    const { resolution } = workspace([EHDS_LAB]);
    expect(resolution.notes.map((n) => n.code)).toEqual(['archetype-not-in-workspace']);
    expect(resolution.sites.filter((s) => s.side === 'openehr').every((s) => !s.result.known && !s.problem)).toBe(true);
  });

  it('steps through a slot into the archetype that fills it', () => {
    const models = new ModelIndex();
    for (const file of files(CKM)) models.set(uriOf(file), readFileSync(file, 'utf8'));
    const index = new WorkspaceIndex();
    const uri = uriOf(join(FIXTURES, 'lab.model.yml'));
    index.set(
      uri,
      XDS_MODEL.replace('openEHR-EHR-CLUSTER.xds_metadata.v0', 'openEHR-EHR-OBSERVATION.laboratory_test_result.v1')
        .replace('DocumentReference', 'Observation')
        .replace('$archetype/items[at0004]', '$archetype/data[at0001]/events[at0002]/data[at0003]/items[openEHR-EHR-CLUSTER.laboratory_test_analyte.v1]/items[at0001]'),
    );
    const entry = index.get(uri)!;
    const site = siteAt(new PathResolver(index, models).resolve(entry), entry.doc.text.indexOf('items[at0001]') + 2)!;
    expect(site.problem).toBeUndefined();
    expect(site.result).toMatchObject({ known: true, rmTypes: ['ELEMENT'] });
    expect((site.result as { nodes: OptNode[] }).nodes[0].owner!.archetypeId).toBe('openEHR-EHR-CLUSTER.laboratory_test_analyte.v1');
  });
});
