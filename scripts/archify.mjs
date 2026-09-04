#!/usr/bin/env node
/**
 * Target-owned Archify delivery boundary.
 *
 * It deliberately invokes the pinned Node CLI only during build/CI, then
 * hardens the checked-in static page before it can be served by Cloudflare.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const VENDOR_CLI = resolve(ROOT, 'vendor/archify/bin/archify.mjs');
const SOURCE_DIR = resolve(ROOT, 'docs/diagrams/src');
const OUTPUT_DIR = resolve(ROOT, 'public/diagrams');
const RECEIPT_DIR = resolve(ROOT, 'docs/diagrams/receipts');
const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export const ARCHIFY_DIAGRAMS = Object.freeze({
  'techwriter-architecture': { type: 'architecture', source: 'techwriter-architecture.architecture.json', output: 'techwriter-architecture.html' },
  'artifact-workflow': { type: 'workflow', source: 'artifact-workflow.workflow.json', output: 'artifact-workflow.html' },
  'chat-request-sequence': { type: 'sequence', source: 'chat-request-sequence.sequence.json', output: 'chat-request-sequence.html' },
  'context-dataflow': { type: 'dataflow', source: 'context-dataflow.dataflow.json', output: 'context-dataflow.html' },
  'provider-circuit-lifecycle': { type: 'lifecycle', source: 'provider-circuit-lifecycle.lifecycle.json', output: 'provider-circuit-lifecycle.html' },
});

function fail(message) {
  console.error(`archify: ${message}`);
  process.exitCode = 1;
}

function sha256(value) {
  // Generated sources and pages are textual Git artifacts. Normalize CRLF so
  // a Windows author and Linux CI attest to the same committed content.
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(`..${sep}`);
}

function diagramById(id) {
  const diagram = ARCHIFY_DIAGRAMS[id];
  if (!diagram) throw new Error(`unknown diagram "${id}"; expected one of ${Object.keys(ARCHIFY_DIAGRAMS).join(', ')}`);
  return { id, ...diagram };
}

function selected(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === 'all')) return Object.keys(ARCHIFY_DIAGRAMS).map(diagramById);
  if (args.length !== 1) throw new Error('supply one checked-in diagram id or "all"');
  return [diagramById(args[0])];
}

function paths(diagram) {
  const source = resolve(SOURCE_DIR, diagram.source);
  const output = resolve(OUTPUT_DIR, diagram.output);
  const receipt = resolve(RECEIPT_DIR, `${diagram.id}.receipt.json`);
  if (!isInside(SOURCE_DIR, source) || !isInside(OUTPUT_DIR, output) || !isInside(RECEIPT_DIR, receipt)) {
    throw new Error(`unsafe registry path for ${diagram.id}`);
  }
  return { source, output, receipt };
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [VENDOR_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(detail);
  }
  return result.stdout;
}

function assertSource(diagram, source) {
  if (!existsSync(source)) throw new Error(`missing source JSON: ${relative(ROOT, source)}`);
  const parsed = JSON.parse(readFileSync(source, 'utf8'));
  if (parsed?.schema_version !== 1 || parsed?.diagram_type !== diagram.type) {
    throw new Error(`${relative(ROOT, source)} is not a schema v1 ${diagram.type} diagram`);
  }
  if (parsed?.meta?.quality_profile !== 'showcase') {
    throw new Error(`${relative(ROOT, source)} must set meta.quality_profile to "showcase"`);
  }
  return parsed;
}

function stripRemoteAssets(html) {
  let removed = 0;
  const withoutLinks = html.replace(/<link\b[^>]*\bhref\s*=\s*(["'])(?:https?:)?\/\/[^"']*\1[^>]*>\s*/gi, () => {
    removed += 1;
    return '';
  });
  const withoutExistingCsp = withoutLinks.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])Content-Security-Policy\1[^>]*>\s*/gi, '');
  // Viewer help links are not render resources, but retaining a remote href
  // would still allow a click to leave the static artifact. Keep the visible
  // control inert so the generated page has no network-bearing URL at all.
  const withoutRemoteHrefs = withoutExistingCsp.replace(/\bhref\s*=\s*(["'])(?:https?:)?\/\/[^"']*\1/gi, () => {
    removed += 1;
    return 'href="#" data-archify-remote-link-removed="true"';
  });
  // Architecture evidence is serialized as JSON and the viewer can turn its
  // `href` values into anchors at runtime. Neutralize those URLs too; retain
  // the repository revision and source path text as local provenance.
  const withoutEvidenceLinks = withoutRemoteHrefs.replace(/"href":"https?:\/\/[^"\r\n]+"/gi, () => {
    removed += 1;
    return '"href":"#"';
  });
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const hardened = /<head\b[^>]*>/i.test(withoutEvidenceLinks)
    ? withoutEvidenceLinks.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${cspTag}`)
    : `${cspTag}\n${withoutEvidenceLinks}`;
  return { html: hardened, removed };
}

function unsafeNetworkReference(html) {
  const attribute = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi;
  let match;
  while ((match = attribute.exec(html))) {
    const value = match[2].trim().toLowerCase();
    if (/^(?:https?:|\/\/|file:|ftp:|ws:|wss:|javascript:)/.test(value)) return match[2];
  }
  const css = /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi;
  while ((match = css.exec(html))) {
    const value = match[2].trim().toLowerCase();
    if (/^(?:https?:|\/\/|file:|ftp:|ws:|wss:|javascript:)/.test(value)) return match[2];
  }
  return null;
}

export function hardenStaticHtml(html) {
  const { html: hardened, removed } = stripRemoteAssets(html);
  const unsafe = unsafeNetworkReference(hardened);
  if (unsafe) throw new Error(`refusing remote or executable resource reference: ${unsafe}`);
  if (!hardened.includes(CSP)) throw new Error('CSP injection failed');
  return { html: hardened, removedRemoteLinks: removed };
}

function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const candidate = resolve(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(candidate, content);
  renameSync(candidate, file);
}

function validate(diagram) {
  const { source } = paths(diagram);
  assertSource(diagram, source);
  const evidenceArgs = diagram.type === 'architecture' ? ['--repo-root', ROOT] : [];
  run(['validate', diagram.type, source, '--quality', 'showcase', '--json', ...evidenceArgs]);
  return source;
}

function deliver(diagram) {
  const { source, output, receipt } = paths(diagram);
  const specification = readFileSync(source);
  validate(diagram);
  const staging = mkdtempSync(resolve(tmpdir(), 'techwriter-archify-'));
  const candidate = resolve(staging, diagram.output);
  try {
    // `deliver` performs Archify's renderer and artifact-quality gate. Its
    // stdout receipt is deliberately not treated as our final receipt because
    // hardening changes the committed bytes.
    const evidenceArgs = diagram.type === 'architecture' ? ['--repo-root', ROOT] : [];
    run(['deliver', diagram.type, source, candidate, '--quality', 'showcase', '--json', ...evidenceArgs]);
    const before = readFileSync(candidate, 'utf8');
    const hardened = hardenStaticHtml(before);
    atomicWrite(output, hardened.html);
    const check = JSON.parse(run(['check', output]));
    check.file = relative(ROOT, output).replaceAll('\\', '/');
    const artifact = readFileSync(output);
    const result = {
      schemaVersion: 1,
      ok: true,
      diagramId: diagram.id,
      type: diagram.type,
      provider: { name: 'Archify', tag: 'v2.13.0', commit: '2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3' },
      source: { path: relative(ROOT, source).replaceAll('\\', '/'), sha256: sha256(specification), bytes: specification.byteLength },
      artifact: { path: relative(ROOT, output).replaceAll('\\', '/'), sha256: sha256(artifact), bytes: artifact.byteLength },
      hardening: {
        staticOnly: true,
        remoteLinksRemoved: hardened.removedRemoteLinks,
        csp: CSP,
        sandboxRequirement: 'allow-scripts allow-downloads; no allow-same-origin',
      },
      quality: check,
    };
    atomicWrite(receipt, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function check(diagram) {
  const { source, output, receipt } = paths(diagram);
  assertSource(diagram, source);
  if (!existsSync(output)) throw new Error(`missing generated artifact: ${relative(ROOT, output)}`);
  if (!existsSync(receipt)) throw new Error(`missing delivery receipt: ${relative(ROOT, receipt)}`);
  const html = readFileSync(output, 'utf8');
  if (!html.includes(CSP)) throw new Error(`${relative(ROOT, output)} is missing the required static CSP`);
  const unsafe = unsafeNetworkReference(html);
  if (unsafe) throw new Error(`${relative(ROOT, output)} contains a disallowed resource: ${unsafe}`);
  const verified = JSON.parse(readFileSync(receipt, 'utf8'));
  const sourceBytes = readFileSync(source);
  const outputBytes = readFileSync(output);
  if (
    verified?.diagramId !== diagram.id
    || verified?.type !== diagram.type
    || verified?.source?.path !== relative(ROOT, source).replaceAll('\\', '/')
    || verified?.source?.sha256 !== sha256(sourceBytes)
    || verified?.artifact?.path !== relative(ROOT, output).replaceAll('\\', '/')
    || verified?.artifact?.sha256 !== sha256(outputBytes)
  ) {
    throw new Error(`${relative(ROOT, receipt)} does not attest to the current source and artifact bytes`);
  }
  JSON.parse(run(['check', output]));
}

function usage() {
  return [
    'Usage: node scripts/archify.mjs <doctor|validate|deliver|build|check> [diagram-id|all]',
    `Diagram ids: ${Object.keys(ARCHIFY_DIAGRAMS).join(', ')}`,
  ].join('\n');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === '--help' || command === 'help') {
    console.log(usage());
  } else if (command === 'doctor') {
    process.stdout.write(run(['doctor']));
  } else if (command === 'validate') {
    for (const diagram of selected(args)) {
      validate(diagram);
      console.log(`validated ${diagram.id}`);
    }
  } else if (command === 'deliver') {
    for (const diagram of selected(args)) {
      const result = deliver(diagram);
      console.log(`delivered ${result.diagramId}: ${result.artifact.path}`);
    }
  } else if (command === 'build') {
    for (const diagram of selected(args)) {
      const result = deliver(diagram);
      console.log(`built ${result.diagramId}: ${result.artifact.path}`);
    }
  } else if (command === 'check') {
    for (const diagram of selected(args)) {
      check(diagram);
      console.log(`checked ${diagram.id}`);
    }
  } else {
    throw new Error(`unknown command "${command}"\n${usage()}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
