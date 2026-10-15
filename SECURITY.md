# Security

## Reporting a vulnerability

Email **contact@bredouille.app** with "security" in the subject. Please do not open a public issue for a vulnerability. We answer within 5 working days and will tell you when a fix ships. Credit is given in the release notes if you want it.

## Scope

In scope: this repository and the server it runs at `mcp.bredouille.app`. The Bredouille API (`api.bredouille.app`) and the site are run by the same team; reports about them are welcome at the same address.

## Design notes

- The server is read-only and stateless. It has no accounts, no secrets that grant access to user data, and no write path to any backend.
- Every tool argument is validated by a zod schema before use. Coordinates outside metropolitan France are refused before any upstream call.
- Upstream calls go only to fixed hosts (`api.bredouille.app`, `geo.api.gouv.fr`). User input never builds a hostname; query values are URL-encoded.
- Upstream bodies are parsed as JSON and checked against a schema, with a 6 s timeout per call. A failure becomes a short French sentence; stack traces and upstream bodies are never returned.
- Logs record the error kind and the upstream name only. Coordinates, place names and tool arguments are never logged.
- The rate limiter keys on a truncated SHA-256 hash of the client address.
- The widget fetches nothing (empty CSP connect and resource lists), escapes every value it renders, and only links to `https://bredouille.app/`.

## Supported versions

Only the latest commit on `main` is deployed and supported.
