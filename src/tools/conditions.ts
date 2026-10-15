import { CLASS_RANK, daysFor, isEmptyPlace, OUTSIDE_TEXT, parseDay, WEEK_DAYS, type DayClass } from '../domain';
import type { Manifest, PointResponse } from '../schemas';
import { SPECIES, type SpeciesInfo } from '../species';
import { UpstreamError } from '../upstream';
import { addDays, fullDate, longDate, parisToday, relativeLabel, shortDate } from '../text';
import { failure, links, refusal, withFooter, type ToolContext, type ToolOutput } from './common';
import { checkPlace, isOutput, placeLabel, speciesOrRefusal } from './place';

export interface ConditionsInput {
  readonly lat: number;
  readonly lon: number;
  readonly espece?: string | undefined;
  readonly jour?: string | undefined;
}

/** What the widget draws: one row of up to 8 days per species. */
export interface CardData {
  readonly [key: string]: unknown;
  readonly kind: 'conditions' | 'meilleurs_jours';
  readonly place: string | null;
  readonly runDate: string;
  readonly today: string;
  readonly highlight: string | null;
  readonly link: string;
  readonly rows: readonly {
    readonly code: string;
    readonly name: string;
    readonly confidence: string | null;
    readonly days: readonly { day: string; short: string; classId: string; label: string; forecast: boolean }[];
  }[];
}

export function cardRow(s: SpeciesInfo, days: readonly DayClass[], manifest: Manifest | null): CardData['rows'][number] {
  return {
    code: s.code,
    name: s.name,
    confidence: manifest?.manifest.species.find((m) => m.code === s.code)?.confidence ?? null,
    days: days.map((d) => ({ day: d.day, short: shortDate(d.day), classId: d.classId, label: d.label, forecast: d.forecast })),
  };
}

export const confidenceNote = (confidence: string | null): string =>
  confidence === 'to_confirm' ? 'Indice à confirmer pour cette espèce : le back-test ne suffit pas encore à le dire vérifié.' : '';

export const where = (place: string | null): string => (place ? `près de ${place}` : 'à ce lieu');

export function dayLine(d: DayClass, today: string): string {
  const tail = d.forecast ? ', prévision' : '';
  return `- ${longDate(d.day)} (${relativeLabel(d.day, today)}${tail}) : ${d.label}`;
}

/** Shared by conditions_lieu and meilleurs_jours: place check, then manifest, point and place name in parallel. */
export async function loadPlace(
  ctx: ToolContext,
  lat: number,
  lon: number,
  code: string | undefined,
): Promise<{ manifest: Manifest | null; point: PointResponse; place: string | null }> {
  const [manifest, point, place] = await Promise.all([
    ctx.data.manifest().catch(() => null),
    ctx.data.point(lat, lon, code),
    placeLabel(ctx, lat, lon),
  ]);
  return { manifest, point, place };
}

export async function conditionsLieu(ctx: ToolContext, input: ConditionsInput): Promise<ToolOutput> {
  const l = links(ctx.siteUrl);
  const outside = checkPlace(input.lat, input.lon, l.map);
  if (outside) return outside;
  const species = input.espece ? speciesOrRefusal(input.espece, l.map) : null;
  if (isOutput(species)) return species;
  const url = species ? l.hub(species) : l.map;
  const today = parisToday(ctx.now());
  const day = input.jour ? parseDay(input.jour, today) : null;
  if (input.jour && !day) {
    return refusal(`Jour non compris (« ${input.jour.slice(0, 40)} »). Exemples : « demain », « samedi », « 2026-10-18 », « J+3 ».`, url);
  }
  if (day && (day < today || day > addDays(today, WEEK_DAYS - 1))) {
    return refusal(`Bredouille donne l’indice d’aujourd’hui à J+7 (jusqu’au ${longDate(addDays(today, WEEK_DAYS - 1))}). Choisissez un jour dans cette fenêtre.`, url);
  }

  let loaded;
  try {
    loaded = await loadPlace(ctx, input.lat, input.lon, species?.code);
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === 'not_found') return refusal(OUTSIDE_TEXT, l.map);
    return failure(error, url);
  }
  const { manifest, point, place } = loaded;
  if (isEmptyPlace(point)) return refusal(OUTSIDE_TEXT, l.map);

  const from = day ?? today;
  const count = day ? 1 : WEEK_DAYS;
  const list = species ? [species] : SPECIES.filter((s) => point.species.some((p) => p.code === s.code));
  const rows = list.map((s) => ({ s, days: daysFor(point, manifest, s.code, from, count) })).filter((r) => r.days.length > 0);
  if (rows.length === 0) return refusal('La carte du jour ne couvre pas encore ces dates. Réessayez plus tard.', url);

  const head = `Indice Bredouille ${where(place)}, cellule de 1 km, carte du ${fullDate(point.run_date)}.`;
  const lines: string[] = [head, ''];
  if (species) {
    lines.push(`${species.name} :`, ...rows[0]!.days.map((d) => dayLine(d, today)));
    const note = confidenceNote(manifest?.manifest.species.find((m) => m.code === species.code)?.confidence ?? null);
    if (note) lines.push('', note);
  } else if (day) {
    lines.push(`${longDate(day)} (${relativeLabel(day, today)}) :`, ...rows.map((r) => `- ${r.s.name} : ${r.days[0]!.label}`));
  } else {
    for (const r of rows) {
      const todayClass = r.days[0]!;
      const best = r.days.reduce((a, b) => (CLASS_RANK[b.classId] > CLASS_RANK[a.classId] ? b : a));
      const bestText = CLASS_RANK[best.classId] > CLASS_RANK[todayClass.classId] ? `, le mieux ${longDate(best.day)} (${best.label.toLowerCase()})` : '';
      lines.push(`- ${r.s.name} : aujourd’hui ${todayClass.label.toLowerCase()}${bestText}`);
    }
  }
  if (rows.some((r) => r.days.some((d) => d.forecast))) lines.push('', 'Les jours à venir reposent sur des prévisions météo : ils peuvent encore changer.');
  lines.push('', 'L’indice compare chaque jour à ce qui est habituel à ce lieu et à cette date. Il ne dit pas qu’il y a des champignons.');

  const structured: CardData = {
    kind: 'conditions',
    place,
    runDate: point.run_date,
    today,
    highlight: day,
    link: url,
    rows: rows.map((r) => cardRow(r.s, daysFor(point, manifest, r.s.code, today, WEEK_DAYS), manifest)),
  };
  return { text: withFooter(lines.join('\n'), url), structured };
}
