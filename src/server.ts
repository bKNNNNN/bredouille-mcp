import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HOW_TO_READ_URI, howToReadResource, SPECIES_URI, speciesResource } from './resources';
import { meilleursJours } from './tools/best-days';
import { links, READ_ONLY, withFooter, type ToolContext, type ToolOutput } from './tools/common';
import { conditionsLieu } from './tools/conditions';
import { geocoder } from './tools/geocode';
import { fiabilite } from './tools/reliability';
import { reglesEtChasse } from './tools/rules';
import { pourquoi } from './tools/why';
import { WIDGET_HTML, WIDGET_MIME, WIDGET_URI } from './widget';

export const SERVER_NAME = 'bredouille';
export const SERVER_VERSION = '0.1.0';

export const INSTRUCTIONS = `Bredouille est une carte française des conditions de pousse des champignons (cèpes, girolles, trompettes de la mort, chanterelles en tube, pieds-de-mouton, bolets bais, pieds bleus, morilles), en France métropolitaine et en Corse, par cellule de 1 km, d’aujourd’hui à J+7.
Pour un lieu donné en mots (« près de Tulle »), appelez d’abord geocoder, puis conditions_lieu ou meilleurs_jours avec les coordonnées obtenues. pourquoi explique un jour ; fiabilite donne les chiffres publiés ; regles_et_chasse donne les règles de cueillette et les dates de chasse d’un département.
Règles : l’indice décrit des conditions, jamais la présence de champignons. Ne dites jamais qu’un champignon est comestible et ne faites aucune identification. Reprenez la ligne de sécurité qui termine chaque réponse.`;

export interface ServerOptions {
  /** Origin of the widget sandbox, for ChatGPT app submission (https://mcp.bredouille.app). */
  readonly widgetDomain?: string | undefined;
}

const lat = z.number().min(-90).max(90).describe('Latitude en degrés décimaux (WGS84), par exemple 45.27.');
const lon = z.number().min(-180).max(180).describe('Longitude en degrés décimaux (WGS84), par exemple 1.77.');
const espece = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .describe('Espèce : code (boletus_edulis_grp) ou nom français (cèpes, girolle, trompette de la mort, chanterelle en tube, pied-de-mouton, bolet bai, pied bleu, morille).');
const jour = z.string().trim().min(1).max(40).describe('Jour : « aujourd’hui », « demain », un jour de la semaine (« samedi »), « J+3 » ou une date AAAA-MM-JJ.');

function toResult(out: ToolOutput): CallToolResult {
  return {
    content: [{ type: 'text', text: out.text }],
    ...(out.structured ? { structuredContent: out.structured } : {}),
    ...(out.isError ? { isError: true } : {}),
  };
}

/** No tool may answer with a stack trace or an upstream body: one French sentence, and the error name in the log. */
function guarded<A>(site: string, run: (args: A) => Promise<ToolOutput>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return toResult(await run(args));
    } catch (error) {
      console.error('[tool]', error instanceof Error ? error.name : 'unknown');
      return toResult({ text: withFooter('Une erreur est survenue. Réessayez dans un moment.', links(site).map), isError: true });
    }
  };
}

const widgetMeta = (invoking: string, invoked: string) => ({
  ui: { resourceUri: WIDGET_URI },
  'openai/outputTemplate': WIDGET_URI,
  'openai/toolInvocation/invoking': invoking,
  'openai/toolInvocation/invoked': invoked,
});

/** One server per request: the Worker is stateless (MCP SDK guidance for stateless transports). */
export function createMcpServer(ctx: ToolContext, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: 'Bredouille' }, { instructions: INSTRUCTIONS });
  const site = ctx.siteUrl;

  server.registerTool(
    'conditions_lieu',
    {
      title: 'Conditions à un lieu',
      description:
        'Indice Bredouille (classe par espèce et par jour) pour la cellule de 1 km d’un lieu de France métropolitaine, d’aujourd’hui à J+7, avec la date de chaque jour. Sans espèce : résumé de toutes les espèces. Avec un jour : ce jour seulement.',
      inputSchema: { lat, lon, espece: espece.optional(), jour: jour.optional() },
      annotations: { title: 'Conditions à un lieu', ...READ_ONLY },
      _meta: widgetMeta('Lecture de la carte…', 'Carte lue'),
    },
    guarded(site, (a) => conditionsLieu(ctx, a)),
  );

  server.registerTool(
    'meilleurs_jours',
    {
      title: 'Meilleurs jours de la semaine',
      description: 'Les meilleurs jours de la semaine pour une espèce à un lieu de France métropolitaine. Dit franchement quand aucun jour ne dépasse l’habituel.',
      inputSchema: { lat, lon, espece },
      annotations: { title: 'Meilleurs jours de la semaine', ...READ_ONLY },
      _meta: widgetMeta('Recherche des meilleurs jours…', 'Semaine lue'),
    },
    guarded(site, (a) => meilleursJours(ctx, a)),
  );

  server.registerTool(
    'pourquoi',
    {
      title: 'Pourquoi cet indice',
      description:
        'Explique l’indice d’un jour pour une espèce à un lieu : facteur limitant, pluie des semaines précédentes, humidité du sol par rapport à l’habitude, température. En français simple.',
      inputSchema: { lat, lon, espece, jour },
      annotations: { title: 'Pourquoi cet indice', ...READ_ONLY },
    },
    guarded(site, (a) => pourquoi(ctx, a)),
  );

  server.registerTool(
    'geocoder',
    {
      title: 'Trouver un lieu',
      description:
        'Trouve les coordonnées d’une commune, d’un code postal ou d’un département de France métropolitaine (« Tulle », « près de Tulle », « 19000 », « Corrèze »). Source : geo.api.gouv.fr (Licence Ouverte).',
      inputSchema: { lieu: z.string().trim().min(2).max(120).describe('Nom de commune, code postal ou département, en France métropolitaine.') },
      annotations: { title: 'Trouver un lieu', ...READ_ONLY },
    },
    guarded(site, (a) => geocoder(ctx, a)),
  );

  server.registerTool(
    'fiabilite',
    {
      title: 'Fiabilité de l’indice',
      description: 'Chiffres de fiabilité publiés pour une espèce (score du back-test, observations datées, régions) et statut : vérifié ou à confirmer.',
      inputSchema: { espece },
      annotations: { title: 'Fiabilité de l’indice', ...READ_ONLY },
    },
    guarded(site, (a) => fiabilite(ctx, a)),
  );

  server.registerTool(
    'regles_et_chasse',
    {
      title: 'Règles de cueillette et chasse',
      description:
        'Règles de cueillette connues (arrêtés relevés par Bredouille) et dates de la saison de chasse d’un département, avec leurs sources. Sinon : « à vérifier en préfecture ».',
      inputSchema: { departement: z.string().trim().min(1).max(60).describe('Numéro (19, 2A) ou nom (Corrèze) du département.') },
      annotations: { title: 'Règles de cueillette et chasse', ...READ_ONLY },
    },
    guarded(site, (a) => reglesEtChasse(ctx, a)),
  );

  server.registerResource(
    'especes',
    SPECIES_URI,
    { title: 'Espèces suivies', description: 'Codes et noms français des espèces de Bredouille, avec le statut de l’indice.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await speciesResource(ctx.data, site) }] }),
  );

  server.registerResource(
    'lire-l-indice',
    HOW_TO_READ_URI,
    { title: 'Lire l’indice', description: 'Comment lire l’indice Bredouille, et ce qu’il ne dit pas.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: howToReadResource(site) }] }),
  );

  const domain = options.widgetDomain?.trim() || undefined;
  server.registerResource(
    'carte-widget',
    WIDGET_URI,
    { title: 'Carte Bredouille', description: 'Carte compacte : lieu, espèces, 8 jours de classes.', mimeType: WIDGET_MIME },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: WIDGET_MIME,
          text: WIDGET_HTML,
          _meta: {
            ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] }, ...(domain ? { domain } : {}) },
            'openai/widgetDescription': 'Carte compacte des conditions Bredouille : lieu, espèce, huit jours de classes colorées et un lien vers bredouille.app.',
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: ['https://bredouille.app'] },
            ...(domain ? { 'openai/widgetDomain': domain } : {}),
          },
        },
      ],
    }),
  );

  return server;
}
