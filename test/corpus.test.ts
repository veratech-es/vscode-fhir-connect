import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFcDocument } from '../src/server/document';
import { validate } from '../src/server/validation';

const CORPUS = join(__dirname, 'fixtures', 'mapping-lib-0.9.0');

function mappingFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return mappingFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

describe('mapping library 0.9.0', () => {
  const files = mappingFiles(CORPUS);

  it('contains the 75 mapping files of the 0.9.0 tag', () => {
    expect(files).toHaveLength(75);
  });

  it('has no errors in any file', () => {
    const errors = files.flatMap((file) => {
      const doc = parseFcDocument(readFileSync(file, 'utf8'));
      expect(doc, file).toBeDefined();
      return validate(doc!)
        .filter((p) => p.severity === 'error')
        .map((p) => `${relative(CORPUS, file)}: ${p.message}`);
    });
    expect(errors).toEqual([]);
  });

  it('only warns about things the openFHIR engine does not know', () => {
    const warnings = files.flatMap((file) =>
      validate(parseFcDocument(readFileSync(file, 'utf8'))!)
        .filter((p) => p.severity === 'warning')
        .map((p) => `${relative(CORPUS, file)}: ${p.message}`),
    );
    expect(warnings).toMatchSnapshot();
  });
});
