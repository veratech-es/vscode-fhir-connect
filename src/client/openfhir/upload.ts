/**
 * Plans the upload of the mapping files and operational templates of a folder to the REST API of an
 * openFHIR engine: which file creates a new object and which one replaces an object the engine
 * already stores. It does not depend on VS Code, so it can be tested on its own.
 */
import { parse } from 'yaml';
import type { StoredKind, StoredObject } from './client';

/** A file of the workspace that can be uploaded. */
export interface LocalFile {
  /** path or URI, only used to report on the file */
  path: string;
  kind: StoredKind;
  /** `metadata.name` of a mapping, the template id of an operational template */
  name: string;
  /** `model` or `extension` for a model mapping */
  type?: string;
  /** the template of a context mapping */
  templateId?: string;
  content: string;
}

export interface UploadStep {
  file: LocalFile;
  action: 'create' | 'update';
  /** the id of the stored object an update replaces */
  id?: string;
  /** name of the stored object an update replaces, when it is not the name of the file */
  replaces?: string;
}

export interface UploadPlan {
  /** in upload order: templates, then models, extensions and contexts */
  steps: UploadStep[];
  /** files that are not uploaded, with the reason */
  skipped: { file: LocalFile; reason: string }[];
}

/**
 * Reads a file as something the engine stores: a FHIRConnect mapping (YAML with
 * `grammar: FHIRConnect/...`) or an operational template (`.opt`). Anything else gives `undefined`.
 */
export function readLocalFile(path: string, content: string): LocalFile | undefined {
  if (/\.opt$/i.test(path)) {
    const templateId = /<template_id>\s*<value>\s*([^<]+?)\s*<\/value>/.exec(content)?.[1];
    return templateId ? { path, kind: 'template', name: unescapeXml(templateId), content } : undefined;
  }
  if (!/\.ya?ml$/i.test(path) || !/^grammar:\s*["']?FHIRConnect\//m.test(content)) return undefined;
  let document: unknown;
  try {
    document = parse(content);
  } catch {
    return { path, kind: 'model', name: '', content };
  }
  const record = (document && typeof document === 'object' ? document : {}) as Record<string, unknown>;
  const name = String((record.metadata as { name?: unknown } | undefined)?.name ?? '');
  const type = typeof record.type === 'string' ? record.type : undefined;
  if (type === 'context') {
    const template = (record.context as { template?: { id?: unknown } } | undefined)?.template?.id;
    return { path, kind: 'context', name, type, templateId: typeof template === 'string' ? template : undefined, content };
  }
  return { path, kind: 'model', name, type, content };
}

const ORDER: Record<string, number> = { template: 0, model: 1, extension: 2, context: 3 };

/** Pairs each file with the object the engine already stores under the same name, if any. */
export function planUpload(files: LocalFile[], stored: StoredObject[]): UploadPlan {
  const steps: UploadStep[] = [];
  const skipped: UploadPlan['skipped'] = [];
  const seen = new Map<string, LocalFile>();
  const sorted = [...files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  for (const file of sorted) {
    if (!file.name) {
      skipped.push({ file, reason: file.kind === 'template' ? 'it has no template_id' : 'it has no metadata.name or is not valid YAML' });
      continue;
    }
    if (file.kind === 'model' && file.type !== 'model' && file.type !== 'extension') {
      skipped.push({ file, reason: `its type is not model, extension or context` });
      continue;
    }
    // the engine keeps one model or extension per name, one template per (case-insensitive) id and one context per template
    const key = `${file.kind}:${keyOf(file.kind, file.name)}`;
    const twin = seen.get(key) ?? (file.kind === 'context' && file.templateId ? seen.get(`context-template:${keyOf('template', file.templateId)}`) : undefined);
    if (twin) {
      skipped.push({ file, reason: `${twin.path} has the same ${file.kind === 'context' && file.name !== twin.name ? 'template' : 'name'}` });
      continue;
    }
    seen.set(key, file);
    if (file.kind === 'context' && file.templateId) seen.set(`context-template:${keyOf('template', file.templateId)}`, file);

    const sameKind = stored.filter((s) => s.kind === file.kind);
    let match = sameKind.find((s) => keyOf(file.kind, s.name) === keyOf(file.kind, file.name));
    if (!match && file.kind === 'context' && file.templateId) {
      match = sameKind.find((s) => s.templateId && keyOf('template', s.templateId) === keyOf('template', file.templateId!));
    }
    steps.push(
      match
        ? { file, action: 'update', id: match.id, replaces: keyOf(file.kind, match.name) === keyOf(file.kind, file.name) ? undefined : match.name || match.id }
        : { file, action: 'create' },
    );
  }
  return { steps, skipped };
}

function rank(file: LocalFile): number {
  return ORDER[file.kind === 'model' ? (file.type ?? 'model') : file.kind] ?? 1;
}

/** Template ids are compared without case, as the engine does; mapping names exactly. */
function keyOf(kind: StoredKind, name: string): string {
  return kind === 'template' ? name.trim().toLowerCase() : name.trim();
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
