#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.ASHA_DEMO_PLAY_HOST ?? '0.0.0.0';
const port = Number(process.env.ASHA_DEMO_PLAY_PORT ?? '4174');
const outDir = path.join(repoRoot, 'harness/out/browser-demo/latest');

function generatePage() {
  const result = spawnSync('npm', ['run', 'browser:demo'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function sendRedirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

generatePage();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/') {
      sendRedirect(response, '/index.html?play=1');
      return;
    }
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const absolutePath = path.resolve(outDir, relativePath);
    const rootWithSep = outDir.endsWith(path.sep) ? outDir : `${outDir}${path.sep}`;
    if (absolutePath !== outDir && !absolutePath.startsWith(rootWithSep)) {
      response.writeHead(403);
      response.end('forbidden\n');
      return;
    }
    if (!existsSync(absolutePath) || !(await stat(absolutePath)).isFile()) {
      response.writeHead(404);
      response.end('not found\n');
      return;
    }
    response.writeHead(200, { 'content-type': contentType(absolutePath) });
    createReadStream(absolutePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});

server.listen(port, host, () => {
  console.log(`ASHA Demo playable scene: http://${host}:${port}/index.html?play=1`);
  console.log(`Serving ${outDir}`);
});
