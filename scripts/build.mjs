import { build } from 'esbuild';
import { mkdir, cp, readFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({
  entryPoints: { page: 'src/page.ts', content: 'src/content.ts', background: 'src/background.ts', options: 'src/options.ts' },
  bundle: true, outdir: 'dist', format: 'iife', target: 'chrome114', sourcemap: true,
  legalComments: 'none', charset: 'utf8'
});
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
for (const file of ['background.js', 'options.js', ...manifest.content_scripts.flatMap(s => s.js)]) {
  await readFile(`dist/${file}`);
}
console.log('已构建：dist（在 Chrome 扩展页面加载此目录）');
