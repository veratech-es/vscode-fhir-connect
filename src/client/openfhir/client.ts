/**
 * HTTP client for an openFHIR engine (https://github.com/openFHIR/openfhir, 3.0.3 or later): the
 * bootstrap of mapping files and the FHIRconnect operations `$toopenehr` and `$tofhir`. It does not
 * depend on VS Code, so it can be tested against a plain HTTP server.
 */

export type CompositionFormat = 'canonical' | 'flat';

/** An issue of a FHIR OperationOutcome. */
export interface OutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code?: string;
  text: string;
  expression?: string[];
}

/** One file of a bootstrap run, as `POST /$bootstrap` reports it. */
export interface BootstrapFile {
  path: string;
  outcome: string;
  entityType?: string;
  entityId?: string;
  message?: string | null;
}

export interface BootstrapSummary {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  files: BootstrapFile[];
}

export interface ToOpenEhrResult {
  /** the Composition, pretty-printed when it is JSON */
  composition: string;
  issues: OutcomeIssue[];
}

export interface ToFhirResult {
  /** the Bundle without its OperationOutcome entries */
  bundle: unknown;
  issues: OutcomeIssue[];
}

export interface OpenFhirOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** A failed call: no answer, an HTTP error, or an answer that is not what the operation returns. */
export class OpenFhirError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly issues: OutcomeIssue[] = [],
  ) {
    super(message);
  }
}

export class OpenFhirClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OpenFhirOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? fetch;
  }

  /** The number of files the engine has loaded from its bootstrap folder; also tells whether it answers. */
  async loadedFiles(): Promise<number> {
    const answer = await this.json('GET', '/bootstrap');
    if (!Array.isArray(answer)) throw new OpenFhirError('The engine did not answer GET /bootstrap with a list of files. Is it openFHIR 3.0.3 or later?');
    return answer.length;
  }

  /** Makes the engine scan its bootstrap folder again and returns what happened to each file. */
  async bootstrap(): Promise<BootstrapSummary> {
    return toSummary(await this.json('POST', '/$bootstrap'));
  }

  /** Maps a FHIR Bundle or resource to an openEHR Composition. */
  async toOpenEhr(resource: string, params: { templateId?: string; format: CompositionFormat; ehrId?: string }): Promise<ToOpenEhrResult> {
    const query = new URLSearchParams({ format: params.format });
    if (params.templateId) query.set('templateId', params.templateId);
    if (params.ehrId) query.set('ehr_id', params.ehrId);
    const answer = await this.json('POST', `/$toopenehr?${query}`, resource);
    if (!isResource(answer, 'Parameters')) throw new OpenFhirError('The engine did not answer with a Parameters resource.');
    const parameters = Array.isArray(answer.parameter) ? (answer.parameter as Record<string, unknown>[]) : [];
    const composition = parameters.find((p) => p.name === 'composition')?.valueString;
    if (typeof composition !== 'string') throw new OpenFhirError('The answer of the engine has no composition.');
    const outcome = parameters.find((p) => p.name === 'outcome')?.resource;
    return { composition: pretty(composition), issues: outcomeIssues(outcome) };
  }

  /** Maps an openEHR Composition (canonical or flat) to a FHIR Bundle. */
  async toFhir(composition: string, params: { templateId?: string; ehrId?: string }): Promise<ToFhirResult> {
    const parameter: Record<string, unknown>[] = [{ name: 'composition', valueString: composition }];
    if (params.templateId) parameter.push({ name: 'templateId', valueString: params.templateId });
    if (params.ehrId) parameter.push({ name: 'context', part: [{ name: 'ehr_id', valueString: params.ehrId }] });
    const answer = await this.json('POST', '/$tofhir', JSON.stringify({ resourceType: 'Parameters', parameter }));
    if (!isResource(answer, 'Bundle')) throw new OpenFhirError('The engine did not answer with a Bundle.');
    const entries = Array.isArray(answer.entry) ? (answer.entry as { resource?: unknown }[]) : [];
    const outcomes = entries.filter((e) => isResource(e.resource, 'OperationOutcome'));
    return {
      bundle: { ...answer, entry: entries.filter((e) => !outcomes.includes(e)) },
      issues: outcomes.flatMap((e) => outcomeIssues(e.resource)),
    };
  }

  private async json(method: 'GET' | 'POST', path: string, body?: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/fhir+json, application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/fhir+json';
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    let response: Response;
    try {
      response = await this.fetch(this.baseUrl + path, { method, headers, body, signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'it did not answer in time' : 'it is not reachable';
      throw new OpenFhirError(`Cannot reach openFHIR at ${this.baseUrl}: ${reason}.`);
    }
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      const issues = outcomeIssues(parsed);
      const detail = issues.map((i) => i.text).join(' ') || text.trim().slice(0, 300) || response.statusText;
      throw new OpenFhirError(`openFHIR answered ${response.status} to ${method} ${path.split('?')[0]}: ${detail}`, response.status, issues);
    }
    if (parsed === undefined && text.trim()) throw new OpenFhirError(`openFHIR did not answer ${method} ${path.split('?')[0]} with JSON.`);
    return parsed;
  }
}

/** The issues of an OperationOutcome; anything else has none. */
export function outcomeIssues(resource: unknown): OutcomeIssue[] {
  if (!isResource(resource, 'OperationOutcome') || !Array.isArray(resource.issue)) return [];
  return (resource.issue as Record<string, unknown>[]).map((issue) => {
    const details = issue.details as { text?: string } | undefined;
    const expression = Array.isArray(issue.expression) ? (issue.expression as string[]) : undefined;
    return {
      severity: (['fatal', 'error', 'warning', 'information'].includes(issue.severity as string) ? issue.severity : 'error') as OutcomeIssue['severity'],
      code: typeof issue.code === 'string' ? issue.code : undefined,
      text: (typeof issue.diagnostics === 'string' && issue.diagnostics) || details?.text || String(issue.code ?? 'issue'),
      expression,
    };
  });
}

/** Tells a flat Composition (keys are paths) from a canonical one. */
export function compositionFormat(json: unknown): CompositionFormat | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  if (record._type === 'COMPOSITION' || 'archetype_node_id' in record) return 'canonical';
  const keys = Object.keys(record);
  return keys.length > 0 && keys.every((k) => k.includes('/')) ? 'flat' : undefined;
}

/** True when the text is a FHIR resource or Bundle. */
export function isFhirResource(json: unknown): boolean {
  return !!json && typeof json === 'object' && typeof (json as { resourceType?: unknown }).resourceType === 'string';
}

function isResource(value: unknown, type: string): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && (value as { resourceType?: unknown }).resourceType === type;
}

function isSummary(value: unknown): value is BootstrapSummary {
  return !!value && typeof value === 'object' && Array.isArray((value as { files?: unknown }).files);
}

function toSummary(value: unknown): BootstrapSummary {
  if (!isSummary(value)) throw new OpenFhirError('The engine did not answer POST /$bootstrap with a bootstrap summary. Is it openFHIR 3.0.3 or later?');
  const count = (n: unknown) => (typeof n === 'number' ? n : 0);
  return { created: count(value.created), updated: count(value.updated), unchanged: count(value.unchanged), failed: count(value.failed), files: value.files };
}

function parseJson(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function pretty(text: string): string {
  const parsed = parseJson(text);
  return parsed === undefined ? text : JSON.stringify(parsed, null, 2);
}
