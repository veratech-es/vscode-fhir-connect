import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoredObject } from '../src/client/openfhir/client';
import { planUpload, readLocalFile, type LocalFile } from '../src/client/openfhir/upload';

const LAB = 'test/fixtures/mapping-lib-1.0.0/projects/org.highmed/KDS/laborbericht';
const OPT = 'test/fixtures/mapping-lib-1.0.0/projects/org.highmed/KDS/resources/openehr/templates/KDS_Laborbericht.opt';

function read(path: string): LocalFile {
  const file = readLocalFile(path, readFileSync(path, 'utf8'));
  if (!file) throw new Error(`${path} is not uploadable`);
  return file;
}

function file(kind: LocalFile['kind'], name: string, extra: Partial<LocalFile> = {}): LocalFile {
  return { path: `${name}.${kind === 'template' ? 'opt' : 'yml'}`, kind, name, type: kind === 'model' ? 'model' : kind === 'context' ? 'context' : undefined, content: '', ...extra };
}

describe('upload files', () => {
  it('reads mappings and operational templates', () => {
    expect(read(`${LAB}/KDS_laborbericht.context.yaml`)).toMatchObject({ kind: 'context', name: 'KDS_laborbericht.context', templateId: 'KDS_Laborbericht' });
    expect(read(`${LAB}/KDS_laborbericht.yml`)).toMatchObject({ kind: 'model', type: 'extension', name: 'KDS_laborbericht' });
    expect(read('test/fixtures/mapping-lib-1.0.0/model/observation/org.openehr/laboratory_test_result.v1.yml')).toMatchObject({
      kind: 'model',
      type: 'model',
      name: 'OBSERVATION.laboratory_test_result.v1',
    });
    expect(read(OPT)).toMatchObject({ kind: 'template', name: 'KDS_Laborbericht' });
  });

  it('leaves out other files', () => {
    expect(readLocalFile('a.yml', 'name: x')).toBeUndefined();
    expect(readLocalFile('a.json', 'grammar: FHIRConnect/v1.0.0')).toBeUndefined();
    expect(readLocalFile('a.opt', '<template/>')).toBeUndefined();
  });
});

describe('upload plan', () => {
  it('replaces what the engine stores under the same name and creates the rest, templates first and contexts last', () => {
    const stored: StoredObject[] = [
      { kind: 'model', id: 'm1', name: 'OBSERVATION.lab.v1', type: 'model' },
      { kind: 'template', id: 't1', name: 'kds_laborbericht' },
      { kind: 'context', id: 'c1', name: 'other.context', type: 'context', templateId: 'KDS_Laborbericht' },
    ];
    const plan = planUpload(
      [
        file('context', 'lab.context', { templateId: 'KDS_Laborbericht' }),
        file('model', 'KDS_lab', { type: 'extension' }),
        file('model', 'OBSERVATION.lab.v1'),
        file('model', 'CLUSTER.new.v1'),
        file('template', 'KDS_Laborbericht'),
      ],
      stored,
    );
    expect(plan.steps.map((s) => [s.file.name, s.action, s.id, s.replaces])).toEqual([
      ['KDS_Laborbericht', 'update', 't1', undefined],
      ['CLUSTER.new.v1', 'create', undefined, undefined],
      ['OBSERVATION.lab.v1', 'update', 'm1', undefined],
      ['KDS_lab', 'create', undefined, undefined],
      // the engine keeps one context per template
      ['lab.context', 'update', 'c1', 'other.context'],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips files with the same name, no name or an unknown type', () => {
    const plan = planUpload(
      [
        file('model', 'A', { path: 'a/A.yml' }),
        file('model', 'A', { path: 'b/A.yml' }),
        file('model', ''),
        file('model', 'B', { type: 'operational' }),
        file('context', 'one', { templateId: 'T' }),
        file('context', 'two', { templateId: 't' }),
      ],
      [],
    );
    expect(plan.steps.map((s) => s.file.path)).toEqual(['a/A.yml', 'one.yml']);
    expect(plan.skipped.map((s) => [s.file.path, s.reason])).toEqual([
      ['.yml', 'it has no metadata.name or is not valid YAML'],
      ['B.yml', 'its type is not model, extension or context'],
      ['b/A.yml', 'a/A.yml has the same name'],
      ['two.yml', 'one.yml has the same template'],
    ]);
  });
});
