#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(repoRoot, 'boundary-policy.json'), 'utf8'));
const artifactManifestPath = resolve(repoRoot, '../asha/ts/artifacts/public-packages/manifest.json');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!existsSync(artifactManifestPath)) {
  fail('missing ASHA public artifact manifest; run `cd ../asha/ts && pnpm run pack:public` first');
} else {
  const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf8'));
  const artifactsByPackage = new Map(
    artifactManifest.packages.map((artifact) => [artifact.package, artifact]),
  );
  const allowedPackages = new Set(policy.typescript.allowedPackages);
  const dependencies = packageJson.dependencies ?? {};

  for (const [name, spec] of Object.entries(dependencies)) {
    if (!name.startsWith('@asha/')) continue;
    if (!allowedPackages.has(name)) {
      fail(`${name} is not allowed by boundary-policy.json`);
      continue;
    }
    if (!artifactsByPackage.has(name)) {
      fail(`${name} is allowed but missing from ASHA public artifact manifest`);
      continue;
    }
    const artifact = artifactsByPackage.get(name);
    if (artifact.version !== '0.1.0') {
      fail(`${name} artifact version ${artifact.version} does not match current demo compatibility baseline 0.1.0`);
    }
    const normalizedSpec = normalize(String(spec).replace(/^file:/, '')).replaceAll('\\\\', '/');
    const packageRoot = `../asha/ts/packages/${name.replace('@asha/', '')}`;
    const tarballRoot = '../asha/ts/artifacts/public-packages/';
    const expectedTarball = `${tarballRoot}${artifact.tarball}`;
    if (normalizedSpec !== packageRoot && normalizedSpec !== expectedTarball) {
      fail(`${name} must resolve through its public package root or packed public artifact, got ${spec}`);
    }
    if (normalizedSpec.includes('/src/') || normalizedSpec.includes('/engine-rs/')) {
      fail(`${name} dependency points at a private ASHA implementation path: ${spec}`);
    }
  }
}

if (failures.length > 0) {
  console.error('asha-testing public artifact check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-testing public artifact check: OK');
