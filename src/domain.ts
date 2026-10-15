import type { IndexClass, Manifest, PointResponse } from './schemas';
import { addDays, fold, isIsoDate, weekdayIndex } from './text';

/** Metropolitan France and Corsica, with a small margin. The API answers null outside the country. */
export const METRO_BOUNDS = { latMin: 41.3, latMax: 51.15, lonMin: -5.25, lonMax: 9.6 } as const;

export function inMetropole(lat: number, lon: number): boolean {
  const b = METRO_BOUNDS;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

export const OUTSIDE_TEXT =
  'Ce lieu est hors de la carte. Bredouille ne couvre que la France métropolitaine et la Corse. Donnez un lieu en France, par exemple une commune ou un département.';

/** Days shown by default: today and the next 7. */
export const WEEK_DAYS = 8;

export type ClassId = 'below' | 'usual' | 'better' | 'best' | 'none' | 'off_season' | 'no_data';

export interface DayClass {
  readonly day: string;
  readonly value: number | null;
  readonly classId: ClassId;
  readonly label: string;
  readonly forecast: boolean;
}

const EXTRA_LABELS: Readonly<Record<'none' | 'off_season' | 'no_data', string>> = {
  none: 'Rien à signaler ici',
  off_season: 'Hors saison',
  no_data: 'Pas de donnée',
};

/** Fallback when the manifest has no classes: the published legend of 2026-10. */
export const DEFAULT_CLASSES: readonly IndexClass[] = [
  { id: 'below', min: 1, max: 39, label_fr: 'Moins bon que d’habitude' },
  { id: 'usual', min: 40, max: 69, label_fr: 'Habituel' },
  { id: 'better', min: 70, max: 89, label_fr: 'Meilleur que d’habitude' },
  { id: 'best', min: 90, max: 100, label_fr: 'Parmi les meilleurs jours du lieu' },
];

const typographic = (s: string): string => s.replace(/'/g, '’');

export function classify(value: number | null, status: string, classes: readonly IndexClass[]): { classId: ClassId; label: string } {
  if (status === 'out_of_season') return { classId: 'off_season', label: EXTRA_LABELS.off_season };
  if (value === null || status !== 'ok') return { classId: 'no_data', label: EXTRA_LABELS.no_data };
  if (value === 0) return { classId: 'none', label: EXTRA_LABELS.none };
  const c = classes.find((k) => value >= k.min && value <= k.max);
  if (!c) return { classId: 'no_data', label: EXTRA_LABELS.no_data };
  return { classId: c.id as ClassId, label: typographic(c.label_fr) };
}

/** Rank used to compare days: the four published classes above anything else. */
export const CLASS_RANK: Readonly<Record<ClassId, number>> = { best: 4, better: 3, usual: 2, below: 1, none: 0, off_season: 0, no_data: -1 };

export function daysFor(point: PointResponse, manifest: Manifest | null, code: string, from: string, count: number): DayClass[] {
  const sp = point.species.find((s) => s.code === code);
  if (!sp) return [];
  const classes = manifest?.manifest.classes ?? DEFAULT_CLASSES;
  const meta = manifest?.manifest.species.find((s) => s.code === code);
  const last = addDays(from, count - 1);
  return sp.days
    .filter((d) => d.day >= from && d.day <= last)
    .map((d) => {
      const m = meta?.days.find((x) => x.day === d.day);
      return { day: d.day, value: d.value, ...classify(d.value, d.status, classes), forecast: m ? m.kind === 'forecast' && (m.lead_days ?? 0) > 0 : d.day > point.run_date };
    });
}

/** True when the API answered for a place it has no data for (outside France, at sea). */
export function isEmptyPlace(point: PointResponse): boolean {
  return point.species.every((s) => s.days.every((d) => d.value === null));
}

const WEEKDAY_WORDS: Readonly<Record<string, number>> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

/**
 * A day as people say it: « 2026-10-17 », « aujourd’hui », « demain »,
 * « après-demain », « samedi », « J+3 », « 17/10 ». Null when not understood.
 */
export function parseDay(input: string, today: string): string | null {
  const raw = input.trim();
  if (isIsoDate(raw)) return raw;
  const f = fold(raw);
  if (f === '' || f === 'aujourd hui' || f === 'aujourdhui' || f === 'today' || f === 'j0' || f === 'j 0') return today;
  if (f === 'demain' || f === 'tomorrow') return addDays(today, 1);
  if (f === 'apres demain') return addDays(today, 2);
  const rel = /^j ?\+ ?(\d{1,2})$/.exec(f);
  if (rel) return addDays(today, Number(rel[1]));
  const word = f.replace(/^(ce |le |prochain |ce prochain )/, '').replace(/ prochain$/, '');
  if (word in WEEKDAY_WORDS) {
    const target = WEEKDAY_WORDS[word]!;
    return addDays(today, (target - weekdayIndex(today) + 7) % 7);
  }
  const dm = /^(\d{1,2})\s*[/.]\s*(\d{1,2})$/.exec(raw);
  if (dm) {
    const year = Number(today.slice(0, 4));
    const pad = (n: string) => n.padStart(2, '0');
    let iso = `${year}-${pad(dm[2]!)}-${pad(dm[1]!)}`;
    if (!isIsoDate(iso)) return null;
    if (iso < addDays(today, -60)) iso = `${year + 1}-${pad(dm[2]!)}-${pad(dm[1]!)}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}
