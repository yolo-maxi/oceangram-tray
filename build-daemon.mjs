import { build } from 'esbuild';

await build({
  entryPoints: ['/home/xiko/oceangram-daemon/src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'resources/daemon-bundle.js',
  format: 'cjs',
  external: [],
  sourcemap: false,
  minify: true,
});
console.log('Daemon bundled to resources/daemon-bundle.js');
