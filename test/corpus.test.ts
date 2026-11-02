import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFhirConnect, parseFcDocument } from '../src/server/document';
import { validate } from '../src/server/validation';

const CORPUS = join(__dirname, 'fixtures', 'mapping-lib-0.9.0');

function mappingFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return mappingFiles(path);
    // a file whose header is commented out is not a mapping file
    return /\.ya?ml$/.test(name) && isFhirConnect(readFileSync(path, 'utf8')) ? [path] : [];
  });
}

const CORPORA = [
  { version: '0.9.0', dir: join(__dirname, 'fixtures', 'mapping-lib-0.9.0'), files: 75, source: 'the 0.9.0 tag' },
  { version: '1.0.0', dir: join(__dirname, 'fixtures', 'mapping-lib-1.0.0'), files: 106, source: 'the main branch' },
];

describe.each(CORPORA)('mapping library $version', ({ version, dir, files: count, source }) => {
  const files = mappingFiles(dir);

  it(`contains the ${count} mapping files of ${source}`, () => {
    expect(files).toHaveLength(count);
  });

  it('declares the grammar version, which the extension supports', () => {
    const versions = new Set(files.map((file) => parseFcDocument(readFileSync(file, 'utf8'))?.supportedGrammar?.version));
    expect([...versions]).toEqual([version]);
  });

  it('has no errors in any file', () => {
    const errors = files.flatMap((file) => {
      const doc = parseFcDocument(readFileSync(file, 'utf8'));
      expect(doc, file).toBeDefined();
      return validate(doc!)
        .filter((p) => p.severity === 'error')
        .map((p) => `${relative(dir, file)}: ${p.message}`);
    });
    expect(errors).toEqual([]);
  });

  it('only warns about things the grammar does not allow', () => {
    const warnings = files.flatMap((file) =>
      validate(parseFcDocument(readFileSync(file, 'utf8'))!)
        .filter((p) => p.severity === 'warning')
        .map((p) => `${relative(dir, file)}: ${p.message}`),
    );
    expect(warnings).toMatchSnapshot();
  });
});
