#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const policyPath = path.join(repoRoot, 'boundary-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const failures = [];

const allowedAshaPackages = new Set(policy.typescript.allowedPackages ?? []);
const unstableDemoPackages = new Set(policy.typescript.unstableDemoPackages ?? []);
const forbiddenAshaPackages = new Set(policy.typescript.forbiddenPackages ?? []);
const allowedAshaPackagePaths = new Set(
  [...allowedAshaPackages].map((packageName) => `../asha/ts/packages/${packageName.replace('@asha/', '')}`),
);
const knownAshaPackageRoot = '../asha/ts/packages/';
const allowedRustCrates = new Set(policy.rust.allowedCrates ?? []);
const allowedAshaPaths = (policy.rust.allowedAshaPaths ?? []).map(normalizePath);
const forbiddenRustPathFragments = (policy.rust.forbiddenPathFragments ?? []).map(normalizePath);
const forbiddenPathFragments = policy.pathRules?.forbiddenFragments ?? [];
const remediation = policy.remediation ?? 'Use public ASHA surfaces or file an engine feature request.';

function fail(message) {
  failures.push(`${message}. ${remediation}`);
}

function normalizePath(value) {
  return value.replaceAll('\\\\', '/');
}

function globFragmentToRegExp(fragment) {
  const escaped = normalizePath(fragment)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^\n"\']*');
  return new RegExp(escaped);
}

function isAllowedAshaRustPath(spec) {
  const normalized = normalizePath(spec);
  return allowedAshaPaths.some((allowedPath) => normalized.includes(allowedPath));
}

function isForbiddenAshaRustPath(spec) {
  const normalized = normalizePath(spec);
  if (!normalized.includes('../asha/engine-rs/crates/')) return false;
  if (isAllowedAshaRustPath(normalized)) return false;
  if (forbiddenRustPathFragments.some((fragment) => normalized.includes(fragment))) return true;
  return true;
}

function normalizeDependencySpec(spec) {
  return normalizePath(String(spec)).replace(/^file:/, '');
}

function validateAshaPackageName(context, packageName) {
  if (!packageName.startsWith('@asha/')) return;
  if (allowedAshaPackages.has(packageName)) return;
  if (unstableDemoPackages.has(packageName)) {
    fail(`${context} targets unstable ASHA demo package ${packageName} without explicit task approval`);
  } else if (forbiddenAshaPackages.has(packageName)) {
    fail(`${context} targets forbidden ASHA package ${packageName}`);
  } else {
    fail(`${context} targets non-approved ASHA package ${packageName}`);
  }
}

function validateDependencySpec(section, name, spec) {
  if (typeof spec !== 'string') return;
  const normalizedSpec = normalizeDependencySpec(spec);
  const npmAliasMatch = spec.match(/^npm:(@asha\/[^@]+)(?:@.+)?$/);
  if (npmAliasMatch) {
    validateAshaPackageName(`${section}.${name} npm alias`, npmAliasMatch[1]);
  }
  if (normalizedSpec.includes(knownAshaPackageRoot)) {
    const packageRoot = normalizedSpec.split(knownAshaPackageRoot, 2)[1]?.split(/[/?#]/, 1)[0];
    const targetPath = `${knownAshaPackageRoot}${packageRoot ?? ''}`;
    const targetPackage = packageRoot ? `@asha/${packageRoot}` : null;
    if (!allowedAshaPackagePaths.has(targetPath)) {
      fail(`${section}.${name} points at non-approved ASHA package root ${spec}`);
    }
    if (targetPackage) {
      validateAshaPackageName(`${section}.${name} path dependency`, targetPackage);
    }
  }
  if (/\.\.\/asha\/.+\/src\//.test(normalizedSpec)) {
    fail(`${section}.${name} points at an ASHA source internals path: ${spec}`);
  }
}

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = packageJson[section] ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    validateAshaPackageName(`${section}.${name}`, name);
    validateDependencySpec(section, name, spec);
  }
}

const scanRoots = ['scripts', 'tests', 'src', 'harness'];
const scannedExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json']);
const importPattern = /(?:from\s+|import\s*\(|import\s+|require\s*\()["']([^"']+)["']/g;
const forbiddenPathPatterns = forbiddenPathFragments.map(globFragmentToRegExp);

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') continue;
      files.push(...walk(full, predicate));
    } else if (predicate(full)) {
      files.push(full);
    }
  }
  return files;
}

function checkImportSpec(rel, spec) {
  const normalizedSpec = normalizePath(spec);
  if (normalizedSpec.startsWith('@asha/') && !allowedAshaPackages.has(normalizedSpec)) {
    if (unstableDemoPackages.has(normalizedSpec)) {
      fail(`${rel} imports unstable ASHA demo package ${normalizedSpec} without explicit task approval`);
    } else {
      fail(`${rel} imports non-approved ASHA package ${normalizedSpec}`);
    }
  }
  if (forbiddenAshaPackages.has(normalizedSpec)) {
    fail(`${rel} imports forbidden ASHA package ${normalizedSpec}`);
  }
  if (/\.\.\/asha\/.+\/src\//.test(normalizedSpec)) {
    fail(`${rel} imports ASHA internals by source path: ${spec}`);
  }
  if (/ts\/packages\/contracts\/src\/generated/.test(normalizedSpec)) {
    fail(`${rel} imports generated contracts by file path: ${spec}`);
  }
  if (/engine-rs\/crates\/.+\/src\//.test(normalizedSpec)) {
    fail(`${rel} imports ASHA Rust crate internals by source path: ${spec}`);
  }
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(normalizedSpec)) {
      fail(`${rel} imports a forbidden ASHA path: ${spec}`);
    }
  }
}

for (const root of scanRoots) {
  for (const file of walk(path.join(repoRoot, root), (full) => scannedExtensions.has(path.extname(full)))) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      checkImportSpec(rel, match[1]);
    }
    if (/call\s*\(\s*["'`]methodName/.test(text) || /methodName\s*,\s*json/.test(text)) {
      fail(`${rel} appears to introduce a generic methodName/json runtime tunnel`);
    }
  }
}

function parseCargoDependencyEntries(tomlText) {
  const entries = [];
  let section = null;
  let dependencySubtable = null;

  function flushDependencySubtable() {
    if (dependencySubtable) {
      entries.push(dependencySubtable);
      dependencySubtable = null;
    }
  }

  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      flushDependencySubtable();
      section = sectionMatch[1];
      const dependencySubtableMatch = section.match(/(?:^|\.)(dependencies|dev-dependencies|build-dependencies)\.([A-Za-z0-9_-]+)$/);
      if (dependencySubtableMatch) {
        dependencySubtable = {
          crateName: dependencySubtableMatch[2],
          value: '',
          pathSpec: null,
          section: dependencySubtableMatch[1],
        };
      }
      continue;
    }
    if (dependencySubtable) {
      const pathMatch = line.match(/^path\s*=\s*["']([^"']+)["']/);
      if (pathMatch) {
        dependencySubtable.pathSpec = pathMatch[1];
        dependencySubtable.value = line;
      }
      continue;
    }
    if (!section || !/(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(section)) continue;
    const depMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!depMatch) continue;
    const [, crateName, value] = depMatch;
    const pathMatch = value.match(/path\s*=\s*["']([^"']+)["']/);
    entries.push({ crateName, value, pathSpec: pathMatch?.[1] ?? null, section });
  }
  flushDependencySubtable();
  return entries;
}

for (const cargoFile of walk(repoRoot, (full) => path.basename(full) === 'Cargo.toml')) {
  const rel = path.relative(repoRoot, cargoFile);
  const text = fs.readFileSync(cargoFile, 'utf8');
  for (const entry of parseCargoDependencyEntries(text)) {
    if (entry.pathSpec && normalizePath(entry.pathSpec).includes('../asha/engine-rs/crates/')) {
      if (!allowedRustCrates.has(entry.crateName) || isForbiddenAshaRustPath(entry.pathSpec)) {
        fail(`${rel} ${entry.section}.${entry.crateName} depends on forbidden ASHA Rust crate path ${entry.pathSpec}`);
      }
    }
    if (entry.pathSpec && /\.\.\/asha\/.+\/src\//.test(normalizePath(entry.pathSpec))) {
      fail(`${rel} ${entry.section}.${entry.crateName} points at an ASHA Rust source internals path ${entry.pathSpec}`);
    }
  }
}

if (failures.length > 0) {
  console.error('asha-testing boundary check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('asha-testing boundary check: OK');
