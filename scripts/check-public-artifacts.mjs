#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(repoRoot, 'boundary-policy.json'), 'utf8'));
const publicSurfacePolicy = loadPublicSurfacePolicy(policy.typescript ?? {});
const artifactManifestPath = resolve(repoRoot, '../asha-engine/ts/artifacts/public-packages/manifest.json');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!existsSync(artifactManifestPath)) {
  fail('missing ASHA public artifact manifest; run `cd ../asha-engine/ts && pnpm run pack:public` first');
} else {
  const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf8'));
  const artifactsByPackage = new Map(
    artifactManifest.packages.map((artifact) => [artifact.package, artifact]),
  );
  const dependencies = packageJson.dependencies ?? {};

  for (const [name, spec] of Object.entries(dependencies)) {
    if (!name.startsWith('@asha/')) continue;
    if (!publicSurfacePolicy.approvedPackageRoots.has(name)) {
      fail(`${name} is not allowed by ${publicSurfacePolicy.manifestPath} for ${publicSurfacePolicy.consumerRole}`);
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
    const packageRoot = `../asha-engine/ts/packages/${name.replace('@asha/', '')}`;
    const tarballRoot = '../asha-engine/ts/artifacts/public-packages/';
    const expectedTarball = `${tarballRoot}${artifact.tarball}`;
    if (normalizedSpec !== packageRoot && normalizedSpec !== expectedTarball) {
      fail(`${name} must resolve through its public package root or packed public artifact, got ${spec}`);
    }
    if (normalizedSpec.includes('/src/') || normalizedSpec.includes('/engine-rs/')) {
      fail(`${name} dependency points at a private ASHA implementation path: ${spec}`);
    }
  }
}

function loadPublicSurfacePolicy(typescriptPolicy) {
  const consumerRole = typescriptPolicy.consumerRole ?? 'asha-testing';
  const manifestPath = resolve(repoRoot, typescriptPolicy.publicSurfaceManifest ?? '../asha-engine/harness/public-surface/ts-packages.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const consumerPolicy = (manifest.consumerPolicies ?? []).find((entry) => entry.consumerRole === consumerRole);
  if (consumerPolicy === undefined) {
    throw new Error(`ASHA public-surface manifest ${manifestPath} has no consumer policy for ${consumerRole}`);
  }
  return {
    consumerRole,
    manifestPath,
    approvedPackageRoots: new Set(consumerPolicy.approvedPackageRoots ?? []),
  };
}

if (failures.length > 0) {
  console.error('asha-testing public artifact check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-testing public artifact check: OK');
