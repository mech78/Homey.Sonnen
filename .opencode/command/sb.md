---
description: Query the sonnenBatterie REST API; endpoint resolved via openapi.json, output via jq.
agent: build
---

Query the sonnenBatterie REST API for: $ARGUMENTS

1. If $ARGUMENTS does not start with `/api/` (or `api/`), first run `scripts/sb endpoints $ARGUMENTS` to find matching documented endpoints and pick the most appropriate one; show the user which endpoint you chose.
2. Then run `scripts/sb curl <path> [METHOD] [JSON-BODY]` and pretty-print the JSON result with `jq`.
3. If the response is an error (401/403), tell the user to run `scripts/sb token set` themselves; never ask for or display the Auth-Token value.
4. Prefer reading the endpoint spec first (`scripts/sb show <path>`) when unsure about parameters or body shape.
5. Never read, print, or echo the Auth-Token; it is handled internally by `scripts/sb`.
