/*
 * Splits the path values of a mapping into steps, with the offset of each step in the value.
 *
 * openEHR paths are archetype paths: `$archetype/data[at0001]/items[at0002 and name/value='x']`.
 * FHIR paths are FHIRPath expressions: `$resource.effective.as(Period).start`.
 */

export interface PathPart {
  text: string;
  /** offset in the path value */
  start: number;
}

/** Splits `text` at `separator`, except inside brackets, parentheses and quotes. */
function split(text: string, separator: string): PathPart[] {
  const parts: PathPart[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === '[' || c === '(') {
      depth++;
    } else if (c === ']' || c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === separator && depth === 0) {
      parts.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  parts.push({ text: text.slice(start), start });
  return parts;
}

export interface OpenEhrStep extends PathPart {
  attribute: string;
  /** what is inside `[...]`, if anything */
  predicate?: string;
  /** node id or archetype id of the predicate */
  code?: string;
  /** `name/value='...'` of the predicate, or the second item of `[at0001, 'name']` */
  name?: string;
}

const STEP = /^([A-Za-z_][\w]*)?(?:\[(.*)\])?$/s;

/** The steps of an openEHR path, without a leading variable; a leading `/` is dropped. */
export function openEhrSteps(path: string, offset = 0): OpenEhrStep[] {
  return split(path, '/')
    .filter((part, i, all) => part.text !== '' || (i === all.length - 1 && i > 0))
    .map((part) => {
      const step: OpenEhrStep = { text: part.text, start: part.start + offset, attribute: part.text };
      const m = STEP.exec(part.text);
      if (!m) return step;
      step.attribute = m[1] ?? '';
      if (m[2] !== undefined) {
        step.predicate = m[2];
        Object.assign(step, parsePredicate(m[2]));
      }
      return step;
    });
}

function parsePredicate(predicate: string): { code?: string; name?: string } {
  const name = /name\/value\s*=\s*(['"])(.*?)\1/.exec(predicate)?.[2] ?? /,\s*(['"])(.*?)\1\s*$/.exec(predicate)?.[2];
  const code = /^\s*([A-Za-z][\w.\-]*)/.exec(predicate)?.[1];
  return { code: code === 'name' ? undefined : code, name };
}

export interface FhirStep extends PathPart {
  /** element name, or the function name for `as(...)`, `where(...)`, ... */
  name: string;
  /** set for function calls */
  args?: string;
}

const FHIR_STEP = /^\s*([A-Za-z_$][\w$]*)\s*(?:\((.*)\))?\s*$/s;

/** The steps of a FHIRPath expression. */
export function fhirSteps(path: string, offset = 0): FhirStep[] {
  return split(path, '.').map((part) => {
    const m = FHIR_STEP.exec(part.text);
    return { text: part.text, start: part.start + offset, name: m?.[1] ?? part.text, args: m?.[2] };
  });
}
