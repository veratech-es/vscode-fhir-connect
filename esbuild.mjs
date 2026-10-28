import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/client/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  }),
  esbuild.context({
    ...common,
    entryPoints: ['src/server/server.ts'],
    outfile: 'dist/server.js',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
