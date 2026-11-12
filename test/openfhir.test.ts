import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compositionFormat, isFhirResource, OpenFhirClient, OpenFhirError, outcomeIssues } from '../src/client/openfhir/client';

interface Call {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

/** A fake openFHIR engine: answers as the REST API of openFHIR 3.0.3 documents it. */
let server: Server;
let baseUrl: string;
let calls: Call[];
let handler: (call: Call, res: ServerResponse) => void;

const SUMMARY = {
  created: 1,
  updated: 0,
  unchanged: 2,
  failed: 1,
  files: [
    { path: 'kds/diagnose.context.yaml', outcome: 'UNCHANGED', entityType: 'CONTEXT', entityId: 'c1', message: null },
    { path: 'model/broken.yml', outcome: 'FAILED', entityType: 'MODEL', entityId: null, message: 'slotArchetype together with slotContext' },
  ],
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/fhir+json'): void {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const call = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      calls.push(call);
      handler(call, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  calls = [];
  handler = (call, res) => send(res, 404, 'not found', 'text/plain');
});

describe('openFHIR client', () => {
  it('reloads the bootstrap folder and returns the summary', async () => {
    handler = (call, res) => send(res, 200, SUMMARY);
    const summary = await new OpenFhirClient({ baseUrl }).bootstrap();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /$bootstrap']);
    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(summary.files[1].message).toBe('slotArchetype together with slotContext');
  });

  it('counts the loaded files', async () => {
    handler = (call, res) => send(res, 200, [{ path: 'a.yml', entityType: 'MODEL' }, { path: 'b.context.yaml', entityType: 'CONTEXT' }], 'application/json');
    expect(await new OpenFhirClient({ baseUrl }).loadedFiles()).toBe(2);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /bootstrap']);
  });

  it('maps a Bundle to openEHR with the template and format as query parameters', async () => {
    handler = (call, res) =>
      send(res, 200, {
        resourceType: 'Parameters',
        parameter: [
          { name: 'composition', valueString: '{"_type":"COMPOSITION","name":{"value":"Laborbefund"}}' },
          {
            name: 'outcome',
            resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'warning', code: 'incomplete', diagnostics: 'Observation.method not mapped', expression: ['Observation.method'] }] },
          },
        ],
      });
    const bundle = JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [] });
    const result = await new OpenFhirClient({ baseUrl, token: 'secret' }).toOpenEhr(bundle, { templateId: 'KDS_Laborbericht', format: 'flat' });
    const [call] = calls;
    expect(call.method).toBe('POST');
    expect(new URL(call.url, baseUrl).pathname).toBe('/$toopenehr');
    expect(Object.fromEntries(new URL(call.url, baseUrl).searchParams)).toEqual({ format: 'flat', templateId: 'KDS_Laborbericht' });
    expect(call.headers['content-type']).toBe('application/fhir+json');
    expect(call.headers.authorization).toBe('Bearer secret');
    expect(call.body).toBe(bundle);
    expect(JSON.parse(result.composition)).toEqual({ _type: 'COMPOSITION', name: { value: 'Laborbefund' } });
    expect(result.composition).toContain('\n  ');
    expect(result.issues).toEqual([{ severity: 'warning', code: 'incomplete', text: 'Observation.method not mapped', expression: ['Observation.method'] }]);
  });

  it('maps a Composition to FHIR in a Parameters resource and splits off the OperationOutcome', async () => {
    handler = (call, res) =>
      send(res, 200, {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Observation', id: 'o1' } },
          { resource: { resourceType: 'Provenance', id: 'p1' } },
          { resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'warning', code: 'incomplete', details: { text: 'at0005 skipped' } }] } },
        ],
      });
    const result = await new OpenFhirClient({ baseUrl }).toFhir('{"kds_laborbericht/category":"x"}', { templateId: 'KDS_Laborbericht' });
    expect(calls[0].url).toBe('/$tofhir');
    expect(JSON.parse(calls[0].body)).toEqual({
      resourceType: 'Parameters',
      parameter: [
        { name: 'composition', valueString: '{"kds_laborbericht/category":"x"}' },
        { name: 'templateId', valueString: 'KDS_Laborbericht' },
      ],
    });
    expect((result.bundle as { entry: { resource: { resourceType: string } }[] }).entry.map((e) => e.resource.resourceType)).toEqual(['Observation', 'Provenance']);
    expect(result.issues.map((i) => i.text)).toEqual(['at0005 skipped']);
  });

  it('turns an OperationOutcome error answer into an error with its issues', async () => {
    handler = (call, res) => send(res, 400, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'required', diagnostics: 'templateId is required for a flat composition' }] });
    const error = await new OpenFhirClient({ baseUrl }).toFhir('{"a/b":1}', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenFhirError);
    expect((error as OpenFhirError).status).toBe(400);
    expect((error as OpenFhirError).message).toBe('openFHIR answered 400 to POST /$tofhir: templateId is required for a flat composition');
    expect((error as OpenFhirError).issues).toHaveLength(1);
  });

  it('reports a plain-text error body', async () => {
    handler = (call, res) => send(res, 500, 'Mapper not found', 'text/plain');
    await expect(new OpenFhirClient({ baseUrl }).loadedFiles()).rejects.toThrow('openFHIR answered 500 to GET /bootstrap: Mapper not found');
  });

  it('reports an engine that is not running', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(new OpenFhirClient({ baseUrl: `http://127.0.0.1:${port}` }).loadedFiles()).rejects.toThrow(`Cannot reach openFHIR at http://127.0.0.1:${port}: it is not reachable.`);
  });

  it('reports a timeout', async () => {
    handler = () => undefined;
    await expect(new OpenFhirClient({ baseUrl, timeoutMs: 100 }).loadedFiles()).rejects.toThrow('it did not answer in time');
  });

  it('rejects answers of another service', async () => {
    handler = (call, res) => send(res, 200, { status: 'UP' }, 'application/json');
    await expect(new OpenFhirClient({ baseUrl }).loadedFiles()).rejects.toThrow('Is it openFHIR 3.0.3 or later?');
    await expect(new OpenFhirClient({ baseUrl }).bootstrap()).rejects.toThrow('Is it openFHIR 3.0.3 or later?');
  });
});

describe('openFHIR REST API', () => {
  it('lists stored mappings and templates by name', async () => {
    handler = (call, res) => {
      if (call.url === '/fc/context')
        return send(res, 200, [{ id: 'c1', type: 'context', metadata: { name: 'lab.context' }, context: { template: { id: 'KDS_Laborbericht' } } }], 'application/json');
      if (call.url === '/fc/model') return send(res, 200, [{ id: 'm1', type: 'extension', metadata: { name: 'KDS_laborbericht' } }, { metadata: { name: 'no id' } }], 'application/json');
      send(res, 200, [{ id: 't1', templateId: 'kds_laborbericht', originalTemplateId: 'KDS_Laborbericht', content: 'redacted' }], 'application/json');
    };
    const client = new OpenFhirClient({ baseUrl });
    expect(await client.listStored('context')).toEqual([{ kind: 'context', id: 'c1', name: 'lab.context', type: 'context', templateId: 'KDS_Laborbericht' }]);
    expect(await client.listStored('model')).toEqual([{ kind: 'model', id: 'm1', name: 'KDS_laborbericht', type: 'extension', templateId: undefined }]);
    expect(await client.listStored('template')).toEqual([{ kind: 'template', id: 't1', name: 'KDS_Laborbericht' }]);
    expect(calls.map((c) => c.url)).toEqual(['/fc/context', '/fc/model', '/opt']);
  });

  it('creates with POST and replaces with PUT, as YAML or XML', async () => {
    handler = (call, res) => send(res, 200, { id: call.url.endsWith('/x1') ? 'x1' : 'new' }, 'application/json');
    const client = new OpenFhirClient({ baseUrl, token: 'secret' });
    expect(await client.store('model', 'grammar: FHIRConnect/v1.0.0')).toBe('new');
    expect(await client.store('template', '<template/>', 'x1')).toBe('x1');
    expect(calls.map((c) => [c.method, c.url, c.headers['content-type'], c.body])).toEqual([
      ['POST', '/fc/model', 'application/x-yaml', 'grammar: FHIRConnect/v1.0.0'],
      ['PUT', '/opt/x1', 'application/xml', '<template/>'],
    ]);
    expect(calls[0].headers.authorization).toBe('Bearer secret');
  });

  it('reports the reason of a refused upload', async () => {
    handler = (_call, res) => send(res, 400, ['A context mapper for this template already exists.'], 'application/json');
    const error = await new OpenFhirClient({ baseUrl }).store('context', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenFhirError);
    expect((error as OpenFhirError).message).toBe('openFHIR answered 400 to POST /fc/context: A context mapper for this template already exists.');
    handler = (_call, res) => send(res, 400, { status: 400, error: 'Bad Request', message: 'I/O error while reading input message' }, 'application/json');
    expect(((await new OpenFhirClient({ baseUrl }).store('model', 'x').catch((e: unknown) => e)) as Error).message).toMatch(/I\/O error while reading input message$/);
  });
});

describe('openFHIR inputs', () => {
  it('tells canonical and flat compositions and FHIR resources apart', () => {
    expect(compositionFormat({ _type: 'COMPOSITION', archetype_node_id: 'openEHR-EHR-COMPOSITION.report.v1' })).toBe('canonical');
    expect(compositionFormat({ 'kds_laborbericht/category|code': '26436-6', 'kds_laborbericht/language|code': 'de' })).toBe('flat');
    expect(compositionFormat({ resourceType: 'Bundle' })).toBeUndefined();
    expect(compositionFormat([])).toBeUndefined();
    expect(isFhirResource({ resourceType: 'Observation' })).toBe(true);
    expect(isFhirResource({ _type: 'COMPOSITION' })).toBe(false);
  });

  it('reads issues only from an OperationOutcome', () => {
    expect(outcomeIssues({ resourceType: 'Bundle' })).toEqual([]);
    expect(outcomeIssues({ resourceType: 'OperationOutcome', issue: [{ severity: 'odd', code: 'processing' }] })).toEqual([
      { severity: 'error', code: 'processing', text: 'processing', expression: undefined },
    ]);
  });
});
