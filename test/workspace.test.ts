import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { complete } from '../src/server/completion';
import { WorkspaceIndex, type FileEntry } from '../src/server/workspace';
import { withCursor } from './helpers';

const CORPUS = join(__dirname, 'fixtures', 'mapping-lib-0.9.0');
const KDS = join(CORPUS, 'projects', 'org.highmed', 'KDS');

function mappingFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return mappingFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

const uriOf = (path: string) => pathToFileURL(path).toString();
const short = (entry: FileEntry) => entry.uri.slice(uriOf(CORPUS).length + 1);

let index: WorkspaceIndex;
const entry = (path: string) => index.get(uriOf(join(CORPUS, path)))!;

beforeAll(() => {
  index = new WorkspaceIndex();
  for (const file of mappingFiles(CORPUS)) index.set(uriOf(file), readFileSync(file, 'utf8'));
});

describe('workspace index', () => {
  it('indexes names, archetype ids and references', () => {
    const context = entry('projects/org.highmed/KDS/procedure/procedure.context.yaml');
    expect(context).toMatchObject({ fileType: 'context', name: 'KDS_Prozedur.context' });
    expect(context.references.map((r) => [r.kind, r.value])).toEqual([
      ['archetypes', 'ACTION.procedure.v1'],
      ['archetypes', 'CLUSTER.case_identification.v0'],
      ['extensions', 'KDS_procedure.v1'],
      ['start', 'ACTION.procedure.v1'],
    ]);
    const text = readFileSync(join(KDS, 'procedure', 'procedure.context.yaml'), 'utf8');
    const first = context.references[0];
    expect(text.slice(first.span.start, first.span.end)).toBe('ACTION.procedure.v1'); // inside the quotes
    expect(entry('model/action/org.openehr/procedure.v1.yml').archetypeId).toBe('openEHR-EHR-ACTION.procedure.v1');
  });

  it('resolves context references to the model and extension files', () => {
    const context = entry('projects/org.highmed/KDS/procedure/procedure.context.yaml');
    expect(context.references.map((r) => index.targets(context, r).map((t) => short(t.entry)))).toEqual([
      ['model/action/org.openehr/procedure.v1.yml'],
      ['model/cluster/org.openehr/case_identification.v0.yml'],
      ['projects/org.highmed/KDS/procedure/KDS_procedure.v1.yml'],
      ['model/action/org.openehr/procedure.v1.yml'],
    ]);
  });

  it('prefers the declaration nearest to the referencing file', () => {
    const person = entry('projects/org.highmed/KDS/person/person.context.yaml');
    const pseudo = entry('projects/org.highmed/KDS/person_pseudo/pseudo_person.context.yaml');
    expect(index.resolve('KDS_gender.v1', person).map(short)).toEqual(['projects/org.highmed/KDS/person/KDS_gender.yml']);
    expect(index.resolve('KDS_gender.v1', pseudo).map(short)).toEqual(['projects/org.highmed/KDS/person_pseudo/KDS_gender.yml']);
  });

  it('accepts the archetype id and falls back to a case-insensitive match', () => {
    expect(index.resolve('openEHR-EHR-ACTION.procedure.v1', undefined, 'model').map(short)).toEqual(['model/action/org.openehr/procedure.v1.yml']);
    expect(index.resolve('action.PROCEDURE.v1', undefined, 'model').map(short)).toEqual(['model/action/org.openehr/procedure.v1.yml']);
  });

  it('resolves appendTo to the method of the extended model', () => {
    const extension = entry('projects/org.highmed/KDS/diagnose/KDS_problem_diagnose.yml');
    const appendTo = extension.references.find((r) => r.kind === 'appendTo')!;
    const [target] = index.targets(extension, appendTo);
    expect(short(target.entry)).toBe('model/evaluation/org.openehr/problem_diagnosis.v1.yml');
    const text = readFileSync(join(CORPUS, short(target.entry)), 'utf8');
    expect(text.slice(target.span.start, target.span.end)).toBe('problemDiagnoseName');
  });

  it('finds every usage of a model and what a rename changes', () => {
    const model = entry('model/cluster/org.openehr/case_identification.v0.yml');
    const usages = index.usages(model).map((u) => `${short(u.entry)} ${u.ref.kind}`);
    expect(usages.length).toBeGreaterThan(5);
    expect(usages).toContain('projects/org.highmed/KDS/procedure/procedure.context.yaml archetypes');
    expect(index.renameLocations(model)).toHaveLength(usages.length + 1);
  });

  it('reports the references of the library that resolve to nothing', () => {
    const problems = [...index.all()].flatMap((e) => index.unresolved(e).map((p) => `${short(e)}: ${p.message}`)).sort();
    expect(problems).toMatchSnapshot();
  });
});

describe('name completion', () => {
  const names = (kind: string) => (kind === 'extensions' ? [{ label: 'KDS_procedure.v1' }] : [{ label: 'ACTION.procedure.v1' }, { label: 'CLUSTER.specimen.v1' }]);

  it('offers model names for slotArchetype', () => {
    const { doc, position } = withCursor(`grammar: FHIRConnect/v0.9.0
type: model
mappings:
  - name: a
    slotArchetype: CLU|`);
    const items = complete(doc, position, undefined, names);
    expect(items.map((i) => i.label)).toEqual(['ACTION.procedure.v1', 'CLUSTER.specimen.v1']);
    expect(items[1].textEdit).toMatchObject({ newText: 'CLUSTER.specimen.v1', range: { start: { character: 19 } } });
  });

  it('offers extension names in context.extensions items', () => {
    const { doc, position } = withCursor(`grammar: FHIRConnect/v0.9.0
type: context
context:
  extensions:
    - KDS.|`);
    expect(complete(doc, position, undefined, names).map((i) => i.label)).toEqual(['KDS_procedure.v1']);
  });
});
