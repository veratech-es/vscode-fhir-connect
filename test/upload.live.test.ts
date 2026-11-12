import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compositionFormat, OpenFhirClient, type StoredKind } from '../src/client/openfhir/client';
import { planUpload, readLocalFile, type LocalFile } from '../src/client/openfhir/upload';

/**
 * Uploads test/fixtures/mapping-lib-1.0.0 through the REST API of a real openFHIR engine and runs
 * the sample lab Bundle with it. It writes to the engine: use one started for the test with an empty
 * bootstrap folder, e.g. `MAPPINGS=/tmp/empty docker compose -f docs/openfhir/docker-compose.yml up -d`,
 * then `OPENFHIR_UPLOAD_URL=http://localhost:8080 npx vitest run test/upload.live.test.ts`. Skipped
 * without OPENFHIR_UPLOAD_URL.
 */
const url = process.env.OPENFHIR_UPLOAD_URL;
const ROOT = 'test/fixtures/mapping-lib-1.0.0';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe.skipIf(!url)('upload to openFHIR (live)', () => {
  const client = new OpenFhirClient({ baseUrl: url ?? '' });
  const files = walk(ROOT)
    .map((path) => readLocalFile(path, readFileSync(path, 'utf8')))
    .filter((f): f is LocalFile => !!f);

  async function upload(): Promise<{ created: number; updated: number; failed: string[] }> {
    const kinds: StoredKind[] = ['template', 'model', 'context'];
    const stored = (await Promise.all(kinds.map((k) => client.listStored(k)))).flat();
    const plan = planUpload(files, stored);
    const result = { created: 0, updated: 0, failed: [] as string[] };
    for (const step of plan.steps) {
      try {
        await client.store(step.file.kind, step.file.content, step.id);
        result[step.action === 'create' ? 'created' : 'updated']++;
      } catch (error) {
        result.failed.push(`${step.file.path}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  it('creates everything once and replaces it the second time', async () => {
    const first = await upload();
    expect(first.created).toBeGreaterThan(100);
    const second = await upload();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(first.created);
    expect(second.failed).toEqual(first.failed);
  }, 120_000);

  it('maps the sample lab Bundle with the uploaded mappings', async () => {
    const bundle = readFileSync('docs/openfhir/laborbericht-bundle.json', 'utf8');
    const result = await client.toOpenEhr(bundle, { templateId: 'KDS_Laborbericht', format: 'flat' });
    expect(compositionFormat(JSON.parse(result.composition))).toBe('flat');
  });
});
