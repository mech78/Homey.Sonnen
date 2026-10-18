#!/usr/bin/env node
/**
 * Fetch Homey app crash reports from Athom's apps API (read-only).
 *
 * Usage:
 *   node fetch-crashes.js [appId] [buildId]
 *
 * - appId defaults to the `id` from ./app.json (cwd)
 * - buildId defaults to the most recent build (fetched via GET /app/{appId}/build)
 *
 * Output:
 * - Raw JSON written to /tmp/opencode/crashes-<appId>-<build>.json
 * - Grouped summary printed to stdout
 *
 * Authentication:
 * - Uses the logged-in Homey CLI session (~/.athom-cli/settings.json) via the
 *   globally installed `homey` package. The plain CLI token is not accepted by
 *   the apps API; a short-lived delegated token (audience: 'apps') is created
 *   in memory for each run and never persisted or printed.
 *
 * Read-only guarantee:
 * - Only GET requests to /app/{appId}/build* are permitted. Any attempt to call
 *   another method (POST/PUT/DELETE) or another path is rejected locally before
 *   an HTTP request is made.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Resolve the globally installed Homey CLI package (provides `homey-api`).
// ---------------------------------------------------------------------------
function resolveHomeyCliDir() {
  if (process.env.HOMEY_CLI_PATH) {
    return path.resolve(process.env.HOMEY_CLI_PATH);
  }
  try {
    // `command -v` works even when `which` is unavailable
    const cli = execFileSync('bash', ['-lc', 'command -v homey'], {
      encoding: 'utf8',
    }).trim();
    if (!cli) throw new Error('homey CLI not found on PATH');
    // Follow symlinks (nvm shims etc.)
    const real = fs.realpathSync(cli.trim());
    // <cliDir>/bin/homey.mjs -> <cliDir>
    return path.dirname(path.dirname(real));
  } catch (err) {
    console.error(
      'Could not locate the Homey CLI. Install it (npm i -g homey) and log in with `homey login`, or set HOMEY_CLI_PATH.'
    );
    process.exit(1);
  }
}

const CLI_DIR = resolveHomeyCliDir();
const homeyApiPath = path.join(CLI_DIR, 'node_modules', 'homey-api');
let AthomApi; // homey/lib/AthomApi.js
let homeyApi; // homey-api package
try {
  homeyApi = require(homeyApiPath);
  AthomApi = require(path.join(CLI_DIR, 'lib', 'AthomApi.js'));
} catch (err) {
  console.error(`Failed to load modules from Homey CLI at ${CLI_DIR}: ${err.message}`);
  process.exit(1);
}

const { AthomAppsAPI } = homeyApi;

/**
 * Candidate locations for app.json, in priority order:
 * 1. ./app.json (generated manifest at repo root or app dir)
 * 2. ./Source/&lt;appId&gt;/app.json (this repo's layout)
 * 3. ./.homeycompose/app.json (compose source manifest)
 */
function findAppJsonCandidates(cwd) {
  const candidates = [path.join(cwd, 'app.json')];
  const sourceDir = path.join(cwd, 'Source');
  try {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(sourceDir, entry.name, 'app.json'));
      }
    }
  } catch (_) {
    // no Source dir
  }
  candidates.push(path.join(cwd, '.homeycompose', 'app.json'));
  return candidates;
}

// ---------------------------------------------------------------------------
// Read-only guard around the apps API
// ---------------------------------------------------------------------------
const ALLOWED_METHODS = new Set(['GET']);
const ALLOWED_PATH_PATTERN = /^\/app\/[^/]+\/build(?:\/[^/]+)?(?:\/crash(?:\/stats)?)?$/;

function assertReadOnly(operation) {
  const method = String(operation.method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(
      `Blocked by read-only guard: only GET requests are permitted (got ${method} ${operation.path})`
    );
  }
  if (!ALLOWED_PATH_PATTERN.test(operation.path)) {
    throw new Error(
      `Blocked by read-only guard: path not allowed (got ${method} ${operation.path})`
    );
  }
}

function createGuardedAppsApi() {
  const api = new AthomAppsAPI({});
  const origCall = api.call.bind(api);
  api.call = async function guardedCall(request) {
    assertReadOnly({
      method: request.method,
      path: request.context && request.context.operation ? request.context.operation.path : request.path,
    });
    return origCall(request);
  };
  return api;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [appIdArg, buildIdArg] = process.argv.slice(2);

  let appId = appIdArg;
  if (!appId) {
    for (const appJsonPath of findAppJsonCandidates(process.cwd())) {
      try {
        const id = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).id;
        if (id) {
          appId = id;
          break;
        }
      } catch (_) {
        // ignore unreadable candidates
      }
    }
  }
  if (!appId) {
    console.error('No appId given and no app.json found in the current directory.');
    process.exit(1);
  }

  const athomApi = new AthomApi();
  await athomApi.getProfile(); // ensures the CLI session is valid and refreshed
  const token = await athomApi.createDelegationToken({ audience: 'apps' });
  const appsApi = createGuardedAppsApi();

  let buildId = buildIdArg ? String(buildIdArg) : null;
  if (!buildId) {
    const builds = await appsApi.getBuilds({ appId, $token: token });
    const list = Array.isArray(builds) ? builds : builds.results || builds.rows || [];
    if (!list.length) {
      console.error(`No builds found for ${appId}.`);
      process.exit(1);
    }
    // Build entries carry an id; newest is assumed first, but sort defensively
    const ids = list
      .map((b) => (typeof b === 'number' ? b : (b.id ?? b.buildId ?? b._id)))
      .filter((v) => v !== undefined && v !== null)
      .map((v) => Number(v));
    ids.sort((a, b) => b - a);
    buildId = String(ids[0]);
    console.log(`No buildId given, using latest build: ${buildId}`);
  }

  const crashes = await appsApi.getCrashes({
    appId,
    buildId,
    $token: token,
  });

  const rows = Array.isArray(crashes) ? crashes : crashes.results || crashes.rows || [];
  const outPath = path.join('/tmp', 'opencode', `crashes-${appId}-build${buildId}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(crashes, null, 1));

  // Grouped summary: unique first stack line, summed count, latest occurrence
  const groups = new Map();
  for (const c of rows) {
    const first = String(c.stack || '').split('\n')[0] || '(no stack)';
    if (!groups.has(first)) {
      groups.set(first, { count: 0, latest: null, version: c.homeyVersion });
    }
    const g = groups.get(first);
    g.count += c.count || 1;
    if (!g.latest || String(c.createdAt) > g.latest) {
      g.latest = c.createdAt;
      g.version = c.homeyVersion;
    }
  }

  console.log(`\nApp: ${appId}, build ${buildId} — ${rows.length} report group(s)`);
  console.log(`Raw JSON: ${outPath}\n`);
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [msg, g] of sorted) {
    console.log(`### ${g.count}x | latest ${g.latest} | Homey v${g.version}`);
    console.log(msg);
    console.log('');
  }
  if (!sorted.length) {
    console.log('No crash reports for this build.');
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
