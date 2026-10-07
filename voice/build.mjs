// Bundles the app with esbuild. `node build.mjs` builds the app into dist/,
// `node build.mjs --test` builds the unit tests into dist-test/.
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';

const common = { bundle: true, logLevel: 'warning', sourcemap: true };

if (process.argv.includes('--test')) {
  await rm('dist-test', { recursive: true, force: true });
  const tests = (await readdir('test')).filter((file) => file.endsWith('.test.ts')).map((file) => `test/${file}`);
  await build({
    ...common,
    entryPoints: tests,
    platform: 'node',
    format: 'cjs',
    outdir: 'dist-test',
    outExtension: { '.js': '.cjs' },
  });
} else {
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist', { recursive: true });
  await Promise.all([
    build({
      ...common,
      entryPoints: ['src/main/main.ts'],
      platform: 'node',
      format: 'cjs',
      // uiohook-napi is a native module and is loaded from node_modules at run time.
      external: ['electron', 'uiohook-napi'],
      outfile: 'dist/main.js',
    }),
    build({
      ...common,
      entryPoints: ['src/main/preload.ts'],
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      outfile: 'dist/preload.js',
    }),
    build({
      ...common,
      entryPoints: ['src/renderer/renderer.ts'],
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
      outfile: 'dist/renderer.js',
    }),
    cp('src/renderer/index.html', 'dist/index.html'),
    cp('src/renderer/styles.css', 'dist/styles.css'),
  ]);
  console.log('Built dist/');
}
