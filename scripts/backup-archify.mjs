#!/usr/bin/env node
/** Create and restore-check an exact-commit Git bundle for Archify releases. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const DEFAULT_OUTPUT = resolve(ROOT, '.archify-backups');

function run(args, cwd = ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git exited ${result.status}`).trim());
  return result.stdout.trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function outputDirectory(args) {
  if (args.length === 0) return DEFAULT_OUTPUT;
  if (args.length !== 2 || args[0] !== '--output') {
    throw new Error('usage: node scripts/backup-archify.mjs create [--output <repository-relative-dir>]');
  }
  const candidate = resolve(ROOT, args[1]);
  if (!isInside(ROOT, candidate)) throw new Error('backup output must remain inside this repository');
  return candidate;
}

function createBundle(args) {
  const output = outputDirectory(args);
  const commit = run(['rev-parse', 'HEAD']);
  const remote = run(['config', '--get', 'remote.origin.url']);
  const dirty = run(['status', '--porcelain']).length > 0;
  mkdirSync(output, { recursive: true });

  const bundle = resolve(output, `techwriter-archify-${commit}.bundle`);
  const checksum = resolve(output, `${basename(bundle)}.sha256`);
  const manifest = resolve(output, `techwriter-archify-${commit}.manifest.json`);

  run(['bundle', 'create', bundle, commit]);
  run(['bundle', 'verify', bundle]);
  const digest = sha256(bundle);
  writeFileSync(checksum, `${digest}  ${basename(bundle)}\n`);

  const restoreRoot = mkdtempSync(resolve(tmpdir(), 'techwriter-archify-restore-'));
  let restoredCommit;
  try {
    run(['clone', '--no-checkout', bundle, restoreRoot], ROOT);
    restoredCommit = run(['rev-parse', 'HEAD'], restoreRoot);
    if (restoredCommit !== commit) throw new Error(`restore drill resolved ${restoredCommit}, expected ${commit}`);
    run(['fsck', '--no-reflogs'], restoreRoot);
  } finally {
    rmSync(restoreRoot, { recursive: true, force: true });
  }

  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    repository: remote,
    commit,
    workingTreeClean: !dirty,
    bundle: { file: basename(bundle), sha256: digest },
    checksum: basename(checksum),
    restoreDrill: { ok: true, restoredCommit, command: 'git clone --no-checkout <bundle> && git fsck --no-reflogs' },
  };
  writeFileSync(manifest, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output: relative(ROOT, output).replaceAll('\\', '/'), commit, bundle: basename(bundle), sha256: digest }, null, 2));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'create') createBundle(args);
  else throw new Error('usage: node scripts/backup-archify.mjs create [--output <repository-relative-dir>]');
} catch (error) {
  console.error(`backup-archify: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
