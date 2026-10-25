import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const MODELS_DIR = fileURLToPath(new URL('./models', import.meta.url));

/** Serve large model files from ./models (outside public/, so they never end up in dist/). Supports Range. */
function serveModels(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    const url: string = req.url ?? '';
    if (!url.startsWith('/models/')) return next();
    const rel = normalize(decodeURIComponent(url.slice('/models/'.length).split('?')[0]));
    if (rel.startsWith('..')) return next();
    const file = join(MODELS_DIR, rel);
    if (!existsSync(file)) return next();
    const size = statSync(file).size;
    const range: string | undefined = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', String(size));
      createReadStream(file).pipe(res);
    }
  };
  return {
    name: 'serve-models',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), serveModels()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: './',
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@litert-lm/core', '@huggingface/transformers'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
