import { CLASS_RANK, daysFor, isEmptyPlace, OUTSIDE_TEXT, WEEK_DAYS, type DayClass } from '../domain';
import { fullDate, longDate, parisToday, relativeLabel } from '../text';
import { UpstreamError } from '../upstream';
import { failure, links, refusal, withFooter, type ToolContext, type ToolOutput } from './common';
import { cardRow, confidenceNote, loadPlace, where, type CardData } from './conditions';
import { checkPlace, isOutput, speciesOrRefusal } from './place';

export interface BestDaysInput {
  readonly lat: number;
  readonly lon: number;
  readonly espece: string;
}

const RANK_USUAL = CLASS_RANK.usual;

/** The best days of the week, at most three, in date order. Ties go to the higher index. */
export function pickBest(days: readonly DayClass[]): DayClass[] {
  const top = Math.max(...days.map((d) => CLASS_RANK[d.classId]));
  return days
    .filter((d) => CLASS_RANK[d.classId] === top)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3)
    .sort((a, b) => a.day.localeCompare(b.day));
}

function verdict(days: readonly DayClass[], today: string): string[] {
  const label = (d: DayClass) => `${longDate(d.day)} (${relativeLabel(d.day, today)})`;
  if (days.every((d) => d.classId === 'off_season')) return ['Hors saison cette semaine pour cette espèce ici.'];
  if (days.every((d) => d.classId === 'none' || d.classId === 'no_data' || d.classId === 'off_season')) {
    return ['Rien à signaler ici cette semaine : la carte ne montre pas d’indice pour cette espèce à ce lieu (habitat peu favorable, ou hors saison).'];
  }
  const best = pickBest(days);
  const top = CLASS_RANK[best[0]!.classId];
  if (top > RANK_USUAL) {
    return [`Meilleurs jours de la semaine : ${best.map(label).join(', ')}, « ${best[0]!.label.toLowerCase()} ».`];
  }
  if (top === RANK_USUAL) {
    return [`Aucun jour au-dessus de l’habituel cette semaine. Jours au niveau habituel : ${best.map(label).join(', ')}.`];
  }
  return [`Aucun jour n’atteint le niveau habituel cette semaine : tous sont moins bons que d’habitude à ce lieu. Le jour le moins défavorable : ${label(best[0]!)}.`];
}

/** The day the card outlines: the best one, only when it is above the usual. */
export function highlightOf(days: readonly DayClass[]): string | null {
  const best = days.length ? pickBest(days)[0] : undefined;
  return best && CLASS_RANK[best.classId] > RANK_USUAL ? best.day : null;
}

export async function meilleursJours(ctx: ToolContext, input: BestDaysInput): Promise<ToolOutput> {
  const l = links(ctx.siteUrl);
  const outside = checkPlace(input.lat, input.lon, l.map);
  if (outside) return outside;
  const species = speciesOrRefusal(input.espece, l.map);
  if (isOutput(species)) return species;
  const url = l.hub(species);
  const today = parisToday(ctx.now());

  let loaded;
  try {
    loaded = await loadPlace(ctx, input.lat, input.lon, species.code);
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === 'not_found') return refusal(OUTSIDE_TEXT, l.map);
    return failure(error, url);
  }
  const { manifest, point, place } = loaded;
  if (isEmptyPlace(point)) return refusal(OUTSIDE_TEXT, l.map);
  const days = daysFor(point, manifest, species.code, today, WEEK_DAYS);
  if (days.length === 0) return refusal('La carte du jour ne couvre pas encore ces dates. Réessayez plus tard.', url);

  const lines = [`${species.name} ${where(place)}, d’aujourd’hui à J+${days.length - 1} (carte du ${fullDate(point.run_date)}).`, '', ...verdict(days, today)];
  const note = confidenceNote(manifest?.manifest.species.find((m) => m.code === species.code)?.confidence ?? null);
  if (note) lines.push(note);
  lines.push('Plus le jour est loin, plus la prévision météo peut changer : revérifiez la veille.');
  const structured: CardData = {
    kind: 'meilleurs_jours',
    place,
    runDate: point.run_date,
    today,
    highlight: highlightOf(days),
    link: url,
    rows: [cardRow(species, days, manifest)],
  };
  return { text: withFooter(lines.join('\n'), url), structured };
}
