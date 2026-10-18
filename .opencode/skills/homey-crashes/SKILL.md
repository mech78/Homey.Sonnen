---
name: Homey Crash Reports
description: Use when asked to read, fetch, or analyze crash reports for a Homey app (e.g. the tools.developer.homey.app/apps/app/<id>/build/<n>/crashes pages). Fetches reports via Athom's apps API using the logged-in Homey CLI credentials, then summarizes them and maps crash locations to source files in the repo.
---

# Homey Crash Reports

Fetch and analyze crash reports for a Homey app. The developer-portal pages
(`tools.developer.homey.app`) require browser login and cannot be scraped;
instead use the helper script in this skill.

## Hard constraints — read only

This skill performs **strictly read-only** access to Athom's apps API.

- It must **never** create builds, modify or retract submissions, approve/reject
  reviews, reply to crashes, or perform any other write operation on the Athom
  apps API — even if asked.
- The script enforces this itself (method + path allow-list, GET only), so do
  not bypass the script with raw `curl`/API calls for anything except pure
  `GET /app/{appId}/build*` requests, if at all.

## How it works (do not re-derive the auth flow)

Run the script — it is the source of truth:

```sh
node scripts/fetch-crashes.js [appId] [buildId]
```

- `appId` defaults to the `id` in `./app.json` of the current working
  directory, so it works from any Homey app repo.
- `buildId` defaults to the most recent build (fetched from
  `GET /app/{appId}/build`).
- Raw JSON is written to `/tmp/opencode/crashes-<appId>-build<n>.json`.
- A grouped summary is printed: one line per unique first stack line, with
  summed occurrence `count`, latest `createdAt`, and `homeyVersion`.

Also note: in this repository the app source lives under `Source/<appId>/`,
including its `app.json`. The script resolves the app ID automatically from
there (falling back to `./app.json` and `.homeycompose/app.json`).

Authentication/technical gotchas (kept here so they survive script changes):

1. The plain Homey CLI token (`~/.athom-cli/settings.json`) is **not** accepted
   by the apps API (`apps-api.athom.com/api/v1`) — it returns 401
   "The provided token is invalid."
2. A short-lived **delegated token** must be created in memory:
   `AthomApi.createDelegationToken({ audience: 'apps' })`, passed per call as
   `$token`.
3. Numeric parameters like `buildId` must be passed as **strings** to
   `AthomAppsAPI` operations or validation throws.
4. Relevant operations: `getBuilds` (`GET /app/{appId}/build`), `getCrashes`
   (`GET /app/{appId}/build/{buildId}/crash`), `getCrashesStats`.
5. Credentials live only in `~/.athom-cli/settings.json` (managed by the
   `homey` CLI). Tokens are never hardcoded, persisted, or printed anywhere.

## Analysis workflow

1. Run the script and read its grouped summary.
2. Read the raw JSON for full stacks when needed.
3. For each crash group, note: total occurrences, latest occurrence, affected
   Homey version(s), and the first stack line.
4. Map stack frames onto repo source files (e.g.
   `drivers/sonnenbatterie/device.js:341`) by reading the referenced files, and
   relate crashes to each other when they share a call site.
5. Report findings as a table plus the likely root causes and suggested fixes.
   Propose changes; do not apply them without confirmation.
