import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compositionFormat, OpenFhirClient, OpenFhirError } from '../src/client/openfhir/client';

/**
 * Runs against a real openFHIR engine whose bootstrap folder is test/fixtures/mapping-lib-1.0.0, e.g.
 * `MAPPINGS=test/fixtures/mapping-lib-1.0.0 docker compose -f docs/openfhir/docker-compose.yml up -d`,
 * then `OPENFHIR_URL=http://localhost:8080 npx vitest run test/openfhir.live.test.ts`. Skipped
 * without OPENFHIR_URL.
 */
const url = process.env.OPENFHIR_URL;
const bundle = readFileSync('docs/openfhir/laborbericht-bundle.json', 'utf8');

describe.skipIf(!url)('openFHIR engine (live)', () => {
  const client = new OpenFhirClient({ baseUrl: url ?? '' });

  it('lists the loaded files and reloads the bootstrap folder', async () => {
    expect(await client.loadedFiles()).toBeGreaterThan(50);
    const summary = await client.bootstrap();
    expect(summary.files.length).toBe(summary.created + summary.updated + summary.unchanged + summary.failed);
    expect(summary.files.find((f) => f.path.endsWith('KDS_laborbericht.context.yaml'))?.outcome).not.toMatch(/fail/i);
  });

  it('maps the sample lab Bundle to a canonical and a flat Composition and back to FHIR', async () => {
    const canonical = await client.toOpenEhr(bundle, { templateId: 'KDS_Laborbericht', format: 'canonical' });
    expect(compositionFormat(JSON.parse(canonical.composition))).toBe('canonical');
    const flat = await client.toOpenEhr(bundle, { templateId: 'KDS_Laborbericht', format: 'flat' });
    expect(compositionFormat(JSON.parse(flat.composition))).toBe('flat');
    expect(flat.issues.every((i) => i.severity === 'warning')).toBe(true);

    const back = await client.toFhir(flat.composition, { templateId: 'KDS_Laborbericht' });
    const types = (back.bundle as { entry: { resource: { resourceType: string } }[] }).entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(expect.arrayContaining(['DiagnosticReport', 'Observation', 'Provenance']));
    expect(types).not.toContain('OperationOutcome');
    const fromCanonical = await client.toFhir(canonical.composition, {});
    expect((fromCanonical.bundle as { entry: unknown[] }).entry.length).toBeGreaterThan(1);
  });

  it('reports the engine errors with their issues', async () => {
    const error = await client.toFhir(JSON.stringify({ 'laborbericht/context/start_time': '2026-10-30T08:15:00+01:00' }), {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenFhirError);
    expect((error as OpenFhirError).status).toBe(400);
    expect((error as OpenFhirError).issues[0].code).toBe('required');
  });
});
