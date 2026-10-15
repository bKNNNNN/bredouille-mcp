import { inMetropole } from '../domain';
import { resolveDept } from '../hunting';
import type { Commune } from '../schemas';
import { fold } from '../text';
import { failure, links, refusal, withFooter, type ToolContext, type ToolOutput } from './common';

export const GEO_ATTRIBUTION = 'Source : API Découpage administratif (geo.api.gouv.fr), données INSEE et IGN, Licence Ouverte 2.0.';

export interface Place {
  readonly [key: string]: unknown;
  readonly nom: string;
  readonly departement: string | null;
  readonly codeDepartement: string | null;
  readonly lat: number;
  readonly lon: number;
}

const LEAD_WORDS = /^(?:(?:tout\s+)?pr[eè]s\s+d(?:e\s+|['’]\s*)|vers\s+|autour\s+d(?:e\s+|['’]\s*)|(?:à|a)\s+c[oô]t[eé]\s+d(?:e\s+|['’]\s*)|du\s+c[oô]t[eé]\s+d(?:e\s+|['’]\s*)|dans\s+le\s+coin\s+d(?:e\s+|['’]\s*)|à\s+|en\s+)/i;

/** « près de Tulle » becomes « Tulle »; « Tulle (19) », « Tulle, Corrèze » give a département hint. */
export function splitQuery(input: string): { name: string; dept: string | null; postcode: string | null } {
  let q = input.trim().replace(/\s+/g, ' ').replace(LEAD_WORDS, '');
  const postcode = /\b(\d{5})\b/.exec(q)?.[1] ?? null;
  let dept: string | null = null;
  const paren = /^(.*?)[\s,]*\(([^)]+)\)\s*$/.exec(q);
  const comma = /^(.*?),\s*(.+)$/.exec(q);
  const trailingCode = /^(.*\D)\s+(2A|2B|\d{2})$/i.exec(q);
  for (const m of [paren, comma, trailingCode]) {
    if (!m) continue;
    const d = resolveDept(m[2]!);
    if (d) {
      dept = d.code;
      q = m[1]!.trim();
      break;
    }
  }
  return { name: q, dept, postcode };
}

export function toPlace(c: Commune): Place | null {
  if (!c.centre) return null;
  const [lon, lat] = c.centre.coordinates;
  if (!inMetropole(lat, lon)) return null;
  return { nom: c.nom, departement: c.departement?.nom ?? null, codeDepartement: c.codeDepartement ?? c.departement?.code ?? null, lat: round4(lat), lon: round4(lon) };
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

const placeLine = (p: Place): string => `- ${p.nom}${p.departement ? ` (${p.departement}, ${p.codeDepartement})` : ''} : lat ${p.lat}, lon ${p.lon}`;

export async function geocoder(ctx: ToolContext, input: { lieu: string }): Promise<ToolOutput> {
  const url = links(ctx.siteUrl).map;
  const { name, dept, postcode } = splitQuery(input.lieu);
  if (!name && !postcode) return refusal('Donnez un nom de commune, un code postal ou un département.', url);
  try {
    let communes: Commune[];
    const deptOnly = !postcode && !dept ? resolveDept(name) : null;
    if (postcode) communes = await ctx.data.communesByPostcode(postcode);
    else if (deptOnly && (/^(2A|2B|\d{1,2})$/i.test(name.trim()) || (await ctx.data.communesByName(name)).every((c) => fold(c.nom) !== fold(name)))) {
      const all = await ctx.data.communesOfDept(deptOnly.code);
      const top = [...all].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 3);
      const places = top.map(toPlace).filter((p): p is Place => p !== null);
      const body = [
        `${deptOnly.name} (${deptOnly.code}) est un département : la carte se lit à la commune. Les plus grandes communes :`,
        ...places.map(placeLine),
        '',
        'Pour un résultat utile, donnez la commune près de laquelle vous comptez marcher.',
        GEO_ATTRIBUTION,
      ];
      return { text: withFooter(body.join('\n'), url), structured: { departement: { code: deptOnly.code, nom: deptOnly.name }, candidates: places } };
    } else communes = await ctx.data.communesByName(name, dept ?? undefined);

    const places = communes.map(toPlace).filter((p): p is Place => p !== null).slice(0, 5);
    if (places.length === 0) {
      return refusal(`Aucune commune de France métropolitaine trouvée pour « ${input.lieu.slice(0, 80)} ». Vérifiez l’orthographe, ou ajoutez le département (par exemple « Tulle (19) »).`, url);
    }
    const [first, ...others] = places;
    const body = [
      `${first!.nom}${first!.departement ? ` (${first!.departement})` : ''} : lat ${first!.lat}, lon ${first!.lon} (centre de la commune).`,
      ...(others.length ? ['', 'Autres communes possibles :', ...others.map(placeLine)] : []),
      ...(deptOnly ? ['', `«\u00a0${deptOnly.name}\u00a0» est aussi un département (${deptOnly.code}) : pour ses dates de chasse et ses règles, utilisez regles_et_chasse.`] : []),
      '',
      'Ces coordonnées servent à interroger conditions_lieu ou meilleurs_jours.',
      GEO_ATTRIBUTION,
    ];
    return { text: withFooter(body.join('\n'), url), structured: { candidates: places } };
  } catch (error) {
    return failure(error, url);
  }
}
