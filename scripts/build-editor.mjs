import { build } from 'esbuild';
await build({
  entryPoints: ['src/editor/main.tsx'],
  bundle: true,
  minify: true,
  jsx: 'automatic',
  outfile: 'public/editor.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
console.log('editor built -> public/editor.js');
