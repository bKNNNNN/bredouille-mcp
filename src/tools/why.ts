import { daysFor, isEmptyPlace, OUTSIDE_TEXT, parseDay, WEEK_DAYS } from '../domain';
import type { DriversDay, DriversResponse } from '../schemas';
import { addDays, deg, fullDate, longDate, mm, parisToday, relativeLabel } from '../text';
import { UpstreamError } from '../upstream';
import { failure, links, refusal, withFooter, type ToolContext, type ToolOutput } from './common';
import { where } from './conditions';
import { checkPlace, isOutput, placeLabel, speciesOrRefusal } from './place';

export interface WhyInput {
  readonly lat: number;
  readonly lon: number;
  readonly espece: string;
  readonly jour: string;
}

const LIMITING_WORDS: Readonly<Record<string, string>> = {
  season: 'la saison (à cette date, l’espèce sort rarement à ce lieu)',
  rain: 'la pluie tombée les semaines précédentes',
  soil: 'l’humidité du sol',
  temperature: 'la température',
  frost: 'le gel récent',
};

/** The limiting factor, said as a brake on a poor day and as « the tightest factor » on a usual or better one. */
export function limitingSentence(limiting: string | null, classId: string | null): string {
  const words = limiting ? LIMITING_WORDS[limiting] : undefined;
  if (!words) return 'Aucun facteur ne freine nettement ce jour-là.';
  if (classId === 'below' || classId === 'none' || classId === null) return `Ce qui freine surtout : ${words}.`;
  return `Le facteur le plus juste ce jour-là est ${words}, comme souvent ici à cette date.`;
}

const WEATHER_NOTE: Readonly<Record<string, string>> = {
  observed: 'Météo mesurée (Météo-France).',
  forecast: 'Météo prévue : elle peut encore changer.',
  normals: 'Trop loin pour une prévision : la météo de ce jour est la normale de saison.',
};

/** « entre 1 et 4 semaines avant », or in days when the window is not whole weeks. */
export function windowWords(minDays: number, maxDays: number): string {
  if (minDays % 7 === 0 && maxDays % 7 === 0) return `entre ${minDays / 7} et ${maxDays / 7} semaine${maxDays > 7 ? 's' : ''} avant`;
  return `entre ${minDays} et ${maxDays} jours avant`;
}

export function rainText(d: DriversDay, p: DriversResponse['params']): string | null {
  if (d.rain_lag_mm === null) return null;
  const usual = d.rain_lag_usual_mm === null ? '' : ` D’habitude à cette date : ${mm(d.rain_lag_usual_mm)}.`;
  const short = d.flags?.rain_short ? ' C’est trop peu pour cette espèce.' : '';
  return `Pluie : ${mm(d.rain_lag_mm)} tombés ${windowWords(p.lag_min_days, p.lag_max_days)}.${usual} Il en faut environ ${mm(p.rain_threshold_mm)} pour cette espèce.${short}`;
}

export function soilText(d: DriversDay): string | null {
  if (d.swi === null) return null;
  let vs = 'comme d’habitude';
  if (d.swi_usual !== null && d.swi_usual > 0) {
    const ratio = d.swi / d.swi_usual;
    if (ratio < 0.9) vs = 'plus sec que d’habitude';
    else if (ratio > 1.1) vs = 'plus humide que d’habitude';
  }
  const range = d.flags?.dry_soil ? ', trop sec pour cette espèce' : d.flags?.wet_soil ? ', trop humide pour cette espèce' : ', dans la plage de l’espèce';
  return `Sol : ${vs} à cette date${range}.`;
}

export function temperatureText(d: DriversDay, p: DriversResponse['params']): string | null {
  if (d.tmin_c === null || d.tmax_c === null) return null;
  const f = d.flags;
  const issues = [f?.frost ? 'gel récent' : null, f?.cold ? 'trop froid sur la semaine' : null, f?.hot ? 'trop chaud sur la semaine' : null].filter(Boolean);
  const verdict = issues.length ? issues.join(', ') : 'dans la plage de l’espèce';
  return `Température : ${deg(d.tmin_c)} à ${deg(d.tmax_c)} ce jour-là, ${verdict} (l’espèce préfère une moyenne de ${deg(p.tmean_low_c)} à ${deg(p.tmean_high_c)}).`;
}

/** Rain events of at least `rain_event_min_mm` in the lag window, the biggest four, in date order. */
export function rainEvents(dr: DriversResponse, day: string): string | null {
  const from = addDays(day, -dr.params.lag_max_days);
  const to = addDays(day, -dr.params.lag_min_days);
  const events = dr.rain
    .filter((r) => r.day >= from && r.day <= to && r.mm !== null && r.mm >= dr.rain_event_min_mm)
    .sort((a, b) => (b.mm ?? 0) - (a.mm ?? 0))
    .slice(0, 4)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (events.length === 0) return `Aucune pluie de ${mm(dr.rain_event_min_mm)} ou plus dans cette fenêtre.`;
  return `Principales pluies de la fenêtre : ${events.map((e) => `${longDate(e.day)}, ${mm(e.mm ?? 0)}${e.weather === 'observed' ? '' : ' (prévue)'}`).join(' ; ')}.`;
}

export async function pourquoi(ctx: ToolContext, input: WhyInput): Promise<ToolOutput> {
  const l = links(ctx.siteUrl);
  const outside = checkPlace(input.lat, input.lon, l.map);
  if (outside) return outside;
  const species = speciesOrRefusal(input.espece, l.map);
  if (isOutput(species)) return species;
  const url = l.hub(species);
  const today = parisToday(ctx.now());
  const day = parseDay(input.jour, today);
  if (!day) return refusal(`Jour non compris (« ${input.jour.slice(0, 40)} »). Exemples : « demain », « samedi », « 2026-10-18 ».`, url);
  if (day < addDays(today, -14) || day > addDays(today, WEEK_DAYS - 1)) {
    return refusal(`L’explication couvre les 14 derniers jours et la semaine à venir (jusqu’au ${longDate(addDays(today, WEEK_DAYS - 1))}).`, url);
  }

  let drivers: DriversResponse;
  let point;
  let place: string | null;
  try {
    [drivers, point, place] = await Promise.all([
      ctx.data.drivers(input.lat, input.lon, species.code),
      ctx.data.point(input.lat, input.lon, species.code),
      placeLabel(ctx, input.lat, input.lon),
    ]);
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === 'not_found') return refusal(`${OUTSIDE_TEXT} (ou explication indisponible pour ce lieu)`, l.map);
    return failure(error, url);
  }
  if (isEmptyPlace(point)) return refusal(OUTSIDE_TEXT, l.map);
  const d = drivers.days.find((x) => x.day === day);
  if (!d || !d.flags) return refusal('Pas d’explication pour ce jour dans le calcul du jour. Essayez un jour plus proche.', url);

  const cls = daysFor(point, null, species.code, day, 1)[0];
  const head = `${species.name} ${where(place)}, ${longDate(day)} (${relativeLabel(day, today)}) : ${cls ? cls.label.toLowerCase() : 'indice inconnu'}.`;
  const framed = limitingSentence(d.limiting, cls?.classId ?? null);
  const facts = [d.flags.in_season ? null : 'Saison : hors de la période habituelle de l’espèce à ce lieu.', rainText(d, drivers.params), rainEvents(drivers, day), soilText(d), temperatureText(d, drivers.params)].filter(
    (x): x is string => x !== null,
  );
  const lines = [head, '', framed, '', ...facts.map((f) => `- ${f}`), '', `${WEATHER_NOTE[d.weather] ?? ''} Météo à la maille de 8 km, calcul du ${fullDate(drivers.run_date)}.`.trim()];
  return { text: withFooter(lines.join('\n'), url) };
}
