---
name: sb-api
description: Query the sonnenBatterie local REST API via the scripts/sb CLI — endpoint lookup from openapi.json, automatic hostname discovery, authenticated curl without ever exposing the Auth-Token. Use when the user asks to curl/query/inspect the sonnen battery API, list REST endpoints, fetch battery data (latestdata, status, configurations, setpoint, powermeter), or debug API access to the battery.
---

# sb — sonnenBatterie REST API CLI

Run from the repo root: `scripts/sb <subcommand> ...` (add `scripts/` to PATH for plain `sb`).

## Subcommands

- `sb endpoints [pattern]` — list documented endpoints (METHOD, path, summary) from `Source/com.sonnen.battery/openapi.json`
- `sb show <path> [METHOD]` — full spec of one endpoint: parameters, request body, responses
- `sb token set|clear|status` — store/remove the Auth-Token (hidden interactive input; stored at `~/.config/sonnen/token`, mode 0600, outside the repo)
- `sb discover` — list cloud-discovered batteries (serial, LAN IP, hostname); `--refresh` forces
- `sb host [--refresh]` — resolve battery host: manual override file > local DNS `sb-<serial>` (within TTL cache) > cloud discovery, cached ~1h
- `sb serial <number>` — pin a battery serial (needed for DNS lookup and multi-battery setups)
- `sb curl <path> [METHOD] [JSON-BODY] [-- extra-curl-args]` — authenticated request; output is raw JSON ready for a jq pipe

## Examples

```bash
sb endpoints latestdata
sb show /api/v2/status GET
sb curl /api/v2/latestdata | jq '.Production_W'
sb curl /api/v2/setpoint/charge/1000 POST
sb curl /api/v2/configurations PUT '{"SomeKey": true}'
```

## Security rules

- The Auth-Token lives at `~/.config/sonnen/token` (mode 0600), OUTSIDE this repo, and is backed by deny permission rules in `.opencode/opencode.json` for `*config/sonnen*` bash commands and path-based read/grep/glob/list/edit.
- NEVER read, cat, print, copy, or echo the token; it must not appear in any command output, log, tool output, or reply. Do not attempt workarounds around the deny rules.
- `sb` injects the Auth-Token header itself (via `curl --header @tmpfile`) and never prints it. It refuses `-v`/`--trace` because they would dump the token.
- If `sb token status` reports "No token stored", ask the user to run `sb token set` themselves — never request the token value in chat.

## Notes

- `openapi.json` is proprietary sonnen content and git-ignored; use it locally for reference only, never commit or push it.
- Cloud discovery endpoint: `https://find-my.sonnen-batterie.com/find` (returns `device` serial and `lanip`).
- The local API is plain HTTP on port 80, e.g. `http://<host>:80/api/v2/latestdata`, authenticated with an `Auth-Token` header.
