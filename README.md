# bredouille-mcp

A remote [MCP](https://modelcontextprotocol.io) server for [Bredouille](https://bredouille.app), a French map of mushroom growing conditions. It lets Claude, ChatGPT and any other MCP client answer questions such as "are conditions good for cèpes near Tulle this weekend?" from Bredouille's published index.

It runs on a Cloudflare Worker (free plan), holds no state, and only reads public data.

> **Safety.** Bredouille describes weather and soil conditions, not mushrooms. It never says that a mushroom is edible and it never identifies anything. Every answer ends with: *« Bredouille indique des conditions, pas des champignons. Faites contrôler toute cueillette. »* Have every harvest checked by a pharmacist or a mycological society before eating anything.

## Endpoint

```
https://mcp.bredouille.app/mcp
```

Streamable HTTP, stateless, JSON responses, no authentication. (Until the custom domain is live, the `workers.dev` URL printed by `wrangler deploy` works the same way.)

## Connect it

**Claude (claude.ai, Desktop, mobile).** Settings → Connectors → *Add custom connector*. Name: `Bredouille`. URL: `https://mcp.bredouille.app/mcp`. No OAuth.

**Claude Code.**

```bash
claude mcp add --transport http bredouille https://mcp.bredouille.app/mcp
```

**ChatGPT.** Open [chatgpt.com/plugins](https://chatgpt.com/plugins), select **+**, then *Add custom MCP server*. Give it a name and a description, enter the URL above under *Connection*, choose no authentication, confirm the warning and select *Create as a plugin*. After a server update, open the connection and select *Refresh*. Labels change often; the [Apps SDK guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt) has the current flow.

**Any other client.** Point a Streamable HTTP transport at the URL. For a quick look: `npx @modelcontextprotocol/inspector` and connect to the URL.

## Tools

| Tool | Input | What it returns |
|---|---|---|
| `conditions_lieu` | `lat`, `lon`, optional `espece`, optional `jour` | Index class per species and day for the 1 km cell, today to J+7, with dates. Refuses places outside metropolitan France and Corsica. |
| `meilleurs_jours` | `lat`, `lon`, `espece` | The best days of the week at that place. Says plainly when no day is above usual. |
| `pourquoi` | `lat`, `lon`, `espece`, `jour` | Why the index is what it is that day: limiting factor, rain over the previous weeks against the usual, soil wetness against the usual, temperature. |
| `geocoder` | `lieu` | Coordinates of a French commune, postcode or département ("près de Tulle", "19000", "Corrèze"), from [geo.api.gouv.fr](https://geo.api.gouv.fr). |
| `fiabilite` | `espece` | Published reliability figures (back-test score, dated observations, regions, forecast stability) and status: *vérifié* or *à confirmer*. |
| `regles_et_chasse` | `departement` | Known picking rules (prefectoral arrêtés found by Bredouille) and the hunting season dates, with sources, or "à vérifier en préfecture". |

`espece` takes a code or a French name, singular or plural: cèpes, girolles, trompettes de la mort, chanterelles en tube, pieds-de-mouton, bolets bais, pieds bleus, morilles. `jour` takes "aujourd’hui", "demain", a weekday, "J+3" or `YYYY-MM-DD`.

Resources: `bredouille://especes` (species codes, names, status), `bredouille://lire-l-indice` (how to read the index and what it does not say), and `ui://bredouille/carte-v1.html` (the card below).

### Card for MCP Apps and ChatGPT

`conditions_lieu` and `meilleurs_jours` also return `structuredContent` and point to a small HTML card (`text/html;profile=mcp-app`, with both `_meta.ui.resourceUri` and `openai/outputTemplate`). The card shows the place, the species and an 8-day strip in the Bredouille palette, with an *Ouvrir sur bredouille.app* link. It fetches nothing. Hosts that do not render widgets get the same information in the text answer.

### Examples

- « Est-ce que c’est le moment pour les cèpes près de Tulle ? » → `geocoder("près de Tulle")`, then `conditions_lieu(45.2685, 1.7663, "cèpes")`.
- « Quel jour aller aux girolles cette semaine autour d’Ussel ? » → `geocoder`, then `meilleurs_jours`.
- « Pourquoi c’est moins bon que d’habitude demain ? » → `pourquoi(…, "cèpes", "demain")`.
- « La chasse est ouverte en Corrèze ? Il y a une limite de cueillette dans les Vosges ? » → `regles_et_chasse`.
- « Ton indice pour les morilles, il est fiable ? » → `fiabilite("morilles")`.

A real answer, from `wrangler dev` against the live API on 15 October 2026:

```
Indice Bredouille près de Tulle (Corrèze), cellule de 1 km, carte du 15 octobre 2026.

Cèpes :
- jeudi 15 octobre (aujourd’hui) : Moins bon que d’habitude
- vendredi 16 octobre (demain, prévision) : Moins bon que d’habitude
…
- jeudi 22 octobre (J+7, prévision) : Habituel

Bredouille indique des conditions, pas des champignons. Faites contrôler toute cueillette.
Sur bredouille.app : https://bredouille.app/champignons/cepes/
```

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Bredouille index, drivers, reliability figures, picking rules found | [api.bredouille.app](https://api.bredouille.app), by Bredouille | Index: CC BY 4.0. Picking rules layer: ODbL 1.0 |
| Observed weather, forecasts | Météo-France (SIM2, ARPEGE), via data.gouv.fr | Licence Ouverte 2.0 |
| Forecasts | ECMWF IFS open data | CC BY 4.0 |
| Forest, elevation | Copernicus Land Monitoring Service, Copernicus DEM | Copernicus open data policy |
| Dated finds used to measure reliability | GBIF.org occurrence records | CC0 1.0 and CC BY 4.0 records only |
| Hunting season dates (bundled, `src/data/hunting-2026-2027.json`) | Prefectoral arrêtés 2026-2027, read by Bredouille on the préfecture site or in the copy published by the Fédération nationale des chasseurs; each département lists its source | Public administrative documents |
| Communes and départements | [API Découpage administratif](https://geo.api.gouv.fr) (INSEE, IGN) | Licence Ouverte 2.0 |

The full list of sources for a run is in `https://api.bredouille.app/api/manifest`. Reliability methods are explained on [bredouille.app/fiabilite](https://bredouille.app/fiabilite/).

## Privacy

- No accounts, no cookies, no storage. The Worker keeps nothing between requests.
- Coordinates are rounded to 0.01° (about 1 km) before they are sent to the Bredouille API and to geo.api.gouv.fr. The server never logs coordinates, place names or tool arguments. Rate limiting keys on a truncated SHA-256 hash of the client address, held in memory for one minute.
- Answers never include the coordinates of the 1 km cell, only the commune name. `geocoder` returns commune centres, which are public.
- Privacy policy: [bredouille.app/confidentialite](https://bredouille.app/confidentialite/).

## Limits and cost

- Rate limit: 30 MCP requests per minute per client (Workers rate limiting binding, counted per Cloudflare location; falls back to a per-isolate counter when the binding is absent). Above that: HTTP 429 with `retry-after: 60`.
- Upstream answers are cached at the edge (Cache API) for 10 minutes, commune lookups for 24 hours, and only after they pass their schema check. The Cache API does nothing on `*.workers.dev`, so each isolate also keeps its last 200 answers in memory. Every upstream call has a 6 s timeout covering the body, and bodies over 2 MB are refused.
- Request bodies over 64 KB are refused.

Fetches per tool call, before the cache:

| Call | Fetches |
|---|---|
| `conditions_lieu`, `meilleurs_jours` | 3 (manifest, point, commune name) |
| `pourquoi` | 3 (drivers, point, commune name) |
| `geocoder` | 1, or 2 for a département name |
| `fiabilite` | 1 (`accuracy.json`, about 250 KB) |
| `regles_et_chasse` | 1 (rules file) |
| `resources/read bredouille://especes` | 1 (manifest) |

Each cache miss also costs one Cache API read and one write, so a call stays under 10 subrequests, far from the free plan's 50. Each MCP message is one Worker request: a client that connects, lists tools and makes one call uses about four. The free plan's 100,000 requests a day therefore cover at least 25,000 questions, more when clients keep their connection. Measured locally in Node: about 1.1 to 1.3 ms of CPU per warm request, about 40 ms for the first request of a fresh isolate. Bundle: 269 KiB gzip.

## Self-hosting

Requirements: Node 22+, a Cloudflare account (free plan is enough).

```bash
npm ci
npm run dev          # http://127.0.0.1:8788/mcp, calls the live API
npm run check        # typecheck + lint + tests
npm run smoke        # starts wrangler dev and runs initialize, tools/list, tools/call (live API)
npx wrangler deploy  # your own <name>.<account>.workers.dev
```

Configuration (`wrangler.toml` `[vars]`):

| Variable | Default | Purpose |
|---|---|---|
| `BREDOUILLE_API_URL` | `https://api.bredouille.app` | Bredouille API base URL |
| `SITE_URL` | `https://bredouille.app` | Base of the links in answers |
| `RATE_LIMIT_PER_MINUTE` | `30` | Fallback limiter, when the binding is absent |
| `WIDGET_DOMAIN` | unset | Widget sandbox origin, for ChatGPT app review |
| `OPENAI_APPS_CHALLENGE` | unset | Token served at `/.well-known/openai-apps-challenge` for ChatGPT domain verification |

Optional bindings: `MCP_LIMITER` (rate limiting) and `BREDOUILLE_API` (service binding to the `bredouille-api` Worker, for deployments on the same Cloudflare account).

Please keep the safety line and the links to bredouille.app if you run a public copy, and credit the index (CC BY 4.0, Bredouille).

## Development

- `src/worker.ts`: HTTP entry, CORS, body limit, rate limit, one MCP server per request.
- `src/server.ts`: tool and resource registration (zod schemas, annotations, widget metadata).
- `src/tools/*`: one file per tool, pure functions over a `DataSource`.
- `src/bredouille.ts`, `src/upstream.ts`: upstream calls, edge cache, timeouts, schema checks.
- `test/`: vitest with mocked fetch and fixtures captured from the live API on 2026-10-15; `scripts/smoke.mjs` runs the real Worker in workerd.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## En français

**bredouille-mcp** est le serveur MCP de [Bredouille](https://bredouille.app), la carte des conditions de pousse des champignons en France. Il permet à Claude, ChatGPT ou tout client MCP de répondre à des questions comme « les cèpes près de Tulle, c’est pour ce week-end ? » à partir de l’indice publié par Bredouille.

- Adresse : `https://mcp.bredouille.app/mcp`, sans compte ni authentification.
- Outils : `conditions_lieu`, `meilleurs_jours`, `pourquoi`, `geocoder`, `fiabilite`, `regles_et_chasse`.
- Couverture : France métropolitaine et Corse, cellule de 1 km, d’aujourd’hui à J+7.
- Données : indice Bredouille (CC BY 4.0), Météo-France, ECMWF, Copernicus, GBIF, arrêtés préfectoraux de chasse, API Découpage administratif.
- Vie privée : rien n’est stocké, les coordonnées sont arrondies à 1 km et ne sont jamais journalisées.

Bredouille indique des conditions, pas des champignons. Il ne dit jamais qu’un champignon est comestible et ne fait aucune identification. Faites contrôler toute cueillette par un pharmacien ou une société mycologique.

## Licence

Code: MIT, © 2026 LAST WORD EURL. See [LICENSE](LICENSE). Data keeps its own licence (table above). Contact: contact@bredouille.app.
