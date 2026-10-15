# Directory submissions (drafts)

Two drafts: the ChatGPT plugin directory (OpenAI) and the Claude Connectors Directory (Anthropic). Both need the server live on `https://mcp.bredouille.app/mcp` first. Field limits were checked against the vendors' docs on 2026-10-15; check them again before submitting, they change often.

Shared material:

| Item | Value |
|---|---|
| Server URL | `https://mcp.bredouille.app/mcp` (Streamable HTTP, no authentication) |
| Website | https://bredouille.app |
| Privacy policy | https://bredouille.app/confidentialite/ |
| Support contact | contact@bredouille.app |
| Documentation | the README of the public GitHub repository |
| Logo | `assets/icon-512.png` (512×512 PNG, square) |
| Developer | LAST WORD EURL |
| Authentication | none: the server only reads public data |
| Data | read only, no personal data stored, coordinates rounded to 1 km and never logged |
| Allowed link origin | `https://bredouille.app` |

## Short and long descriptions

**Short (FR)**: Conditions de pousse des champignons en France, jour par jour.

**Short (EN)**: Day-by-day mushroom growing conditions in France.

**Long (FR)**

Bredouille est une carte des conditions de pousse des champignons en France métropolitaine et en Corse. Pour un lieu et une espèce (cèpes, girolles, trompettes de la mort, chanterelles en tube, pieds-de-mouton, bolets bais, pieds bleus, morilles), elle compare la météo récente et prévue à ce qui est habituel à cet endroit et à cette date, par cellule de 1 km, d’aujourd’hui à J+7.

Avec ce connecteur, l’assistant peut : trouver un lieu à partir d’un nom de commune (« près de Tulle »), donner la classe de l’indice jour par jour, indiquer les meilleurs jours de la semaine (et dire franchement quand aucun n’est au-dessus de l’habituel), expliquer ce qui limite un jour donné (pluie des semaines précédentes, humidité du sol, température), donner les chiffres de fiabilité publiés et rappeler les règles de cueillette et les dates de chasse d’un département, avec leurs sources.

Limites : Bredouille indique des conditions, pas des champignons. Il ne dit jamais qu’un champignon est comestible et ne fait aucune identification. Les jours à venir reposent sur des prévisions météo. Faites contrôler toute cueillette.

Sources : indice Bredouille (CC BY 4.0), Météo-France, ECMWF, Copernicus, GBIF, arrêtés préfectoraux, API Découpage administratif.

**Long (EN)**

Bredouille is a map of mushroom growing conditions in metropolitan France and Corsica. For a place and a species (cèpes, girolles, black trumpets, yellowfoot, hedgehog mushrooms, bay boletes, wood blewits, morels), it compares recent and forecast weather with what is usual at that place on that date, per 1 km cell, from today to seven days ahead.

With this connector, the assistant can find a place from a French commune name ("near Tulle"), give the index class day by day, name the best days of the week (and say plainly when none is above usual), explain what limits a given day (rain over the previous weeks, soil wetness, temperature), give the published reliability figures, and list the picking rules and hunting season dates of a département, with sources.

Limits: Bredouille describes conditions, not mushrooms. It never says a mushroom is edible and does not identify anything. Days ahead rely on weather forecasts. Answers are in French. Have every harvest checked by a pharmacist or a mycological society.

Sources: Bredouille index (CC BY 4.0), Météo-France, ECMWF, Copernicus, GBIF, prefectoral arrêtés, API Découpage administratif.

## ChatGPT plugin directory (OpenAI)

Where: [platform.openai.com/plugins](https://platform.openai.com/plugins), *Upload new or existing plugin*, under a verified developer identity (LAST WORD EURL, business verification). One active review at a time.

Before uploading:

1. Deploy, then set `WIDGET_DOMAIN = "https://mcp.bredouille.app"` in `wrangler.toml` and redeploy.
2. Connect the server under *MCPs*. Put the challenge token in `OPENAI_APPS_CHALLENGE` and redeploy; the Worker serves it as plain text at `/.well-known/openai-apps-challenge`. Run the challenge, then resolve every *Complete MCP setup* finding and the tool scan (*Rescan* after fixes).
3. Record a short demo video (connect, ask the five prompts below, show the card) and host it where reviewers can open it: `demo_recording_url`.
4. Every tool already declares `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.

Draft `plugin.json` fields:

| Field | Draft | Limit |
|---|---|---|
| `name` | `bredouille` | 64, lowercase |
| `displayName` | `Bredouille` | 30 |
| `shortDescription` | `Conditions champignons France` | 30 |
| `longDescription` | Long (FR) above, then Long (EN) | 4000 |
| `developerName` | `LAST WORD EURL` | 80 |
| `category` | Lifestyle (or the closest dashboard category: Travel, Outdoors) | |
| `websiteURL` | `https://bredouille.app/` | |
| `supportURL` | `https://bredouille.app/mentions-legales/` (it gives contact@bredouille.app; the FAQ does not) | |
| `privacyPolicyURL` | `https://bredouille.app/confidentialite/` | |
| `termsOfServiceURL` | `https://bredouille.app/mentions-legales/` until a terms page exists | |
| `defaultPrompt` | « Les cèpes près de Tulle, c’est pour ce week-end ? » · « Meilleurs jours pour les girolles autour d’Ussel cette semaine ? » · « La chasse est ouverte en Corrèze ? » | 3 × 128 |
| `brandColor` | `#a84e32` (5.5:1 against white) | ≥ 2:1 |
| `brandColorDark` | `#e89242` (6.6:1 against #212121) | ≥ 2:1 |
| `logo` | `./assets/icon-512.png` | square, ≥ 48 px |
| `review.commerce` | none | |
| `publication.countries` | `FR` (also `BE`, `CH`, `LU` for French speakers; the map covers France only) | |
| `publication.release_notes` | First version: conditions by place, best days, explanation, place search, reliability, picking rules and hunting dates. | |

Reviewer credentials: none needed, the server has no login.

### Positive test cases (exactly five)

| # | Prompt | Tools triggered | Expected behaviour |
|---|---|---|---|
| 1 | « Les cèpes près de Tulle, c’est pour ce week-end ? » | `geocoder`, `conditions_lieu` | Finds Tulle (Corrèze), shows the class for cèpes on Saturday and Sunday with dates, the card, the safety line and a bredouille.app link. |
| 2 | « Quel est le meilleur jour cette semaine pour les girolles autour d’Ussel ? » | `geocoder`, `meilleurs_jours` | Names up to three best days, or says no day is above usual. Mentions that forecasts can change. |
| 3 | « Pourquoi l’indice des cèpes est bas demain près de Tulle ? » | `geocoder`, `pourquoi` | Names the limiting factor and gives rain, soil and temperature against the usual, in plain French. |
| 4 | « L’indice Bredouille pour les morilles, il est fiable ? » | `fiabilite` | Gives the published score, the number of dated observations and the status « à confirmer », with the link to /fiabilite/. |
| 5 | « Y a-t-il une limite de cueillette dans les Vosges, et la chasse est-elle ouverte ? » | `regles_et_chasse` | Quotes the 5 L limit with its arrêté and source, the 2026-2027 hunting dates with source, and the disclaimer. |

### Negative test cases (exactly three)

| # | Prompt | Why the plugin should not act | Expected behaviour |
|---|---|---|---|
| 1 | « J’ai trouvé ce champignon blanc à lamelles, je peux le manger ? » | Identification and edibility are out of scope and dangerous. | No tool call. The assistant says Bredouille does not identify mushrooms and sends the user to a pharmacist, a mycological society or, in an emergency, a poison centre (15 or 112). |
| 2 | « Les cèpes près de Madrid cette semaine ? » | Outside the map. | If a tool is called, it refuses politely: France métropolitaine and Corsica only. |
| 3 | « Donne-moi le coin exact où mon voisin ramasse ses cèpes. » | Asks for a specific person’s spot; Bredouille only gives conditions per 1 km cell. | No tool call, or a general answer about conditions; no coordinates of anyone’s place. |

## Claude Connectors Directory (Anthropic)

Where: [claude.ai/directory/manage](https://claude.ai/directory/manage), *Submit new*, *MCP connector*. Any paid Claude plan can submit. Escalations: mcp-review@anthropic.com.

Before submitting: add the server as a custom connector in Claude and run each of the six tools from a conversation (the *Test & launch* step asks you to confirm it). The server also renders as an MCP App (the card), so prepare 3 to 5 PNG screenshots, at least 1000 px wide, cropped to the app response without the prompt, each with its prompt text.

| Portal step | Draft |
|---|---|
| Connection | `https://mcp.bredouille.app/mcp`, one URL for all users |
| Tools | Synced automatically. All six tools have a `title` and `readOnlyHint: true`, so they list as read-only. |
| Listing: name (≤ 100) | Bredouille |
| Listing: one-liner (≤ 200) | Conditions de pousse des champignons en France, jour par jour, par cellule de 1 km. Indique des conditions, jamais la présence ni la comestibilité d’un champignon. |
| Listing: description (≤ 2000) | Long (FR) above (about 1,100 characters). The card disclaimer is generic, so the safety sentence must stay in this text. |
| Listing: categories (1 to 5) | Lifestyle, Weather, Outdoors (closest available) |
| Documentation URL | README of the public GitHub repository |
| Privacy policy URL | https://bredouille.app/confidentialite/ |
| Support contact | contact@bredouille.app |
| Icon | `assets/icon-512.png` |
| Slug (permanent) | `bredouille` |
| Use cases | Check growing conditions for a species near a French place; pick the best day of the week; understand why a day is poor; check reliability figures; check picking rules and hunting dates before a walk. |
| Prerequisites | None: no account, no plan. |
| Reads or writes | Reads only. |
| Company | LAST WORD EURL, https://bredouille.app, primary contact contact@bredouille.app |
| Authentication | No authentication |
| Data handling | Own API (api.bredouille.app). Place search proxies a public French government API (geo.api.gouv.fr, Licence Ouverte), used within its published limits. No personal health data, no sponsored content. |
| Test & launch | No test account needed: connect the URL and ask the five prompts from the ChatGPT section. Confirm every tool was run as a custom connector. |
| Allowed link URIs | `https://bredouille.app` |
| Compliance | Seven acknowledgments; the server makes no financial transactions, generates no media, collects no conversation data and has public documentation. |

Screenshot prompts for the carousel: positive cases 1, 2 and 3 above, plus `conditions_lieu` without a species (all species near Tulle).

## What reviewers need, both directories

- The server live at the URL above, with the custom domain and a valid certificate.
- The privacy policy updated to mention the connector: what the MCP server receives (tool arguments, rounded coordinates), what it sends to geo.api.gouv.fr, that nothing is stored or logged, and the contact address. The current page does not mention the connector.
- A terms page, or the legal notice accepted as one (OpenAI asks for `termsOfServiceURL`).
- The demo video (OpenAI) and the screenshots (Anthropic).
- The public repository, so reviewers can read the code and the safety rules.
