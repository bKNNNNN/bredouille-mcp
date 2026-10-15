/** French typography and date helpers. No Intl: Workers and Node must print the same strings. */

export const NBSP = ' ';
export const NNBSP = ' ';

export const SAFETY_LINE = `Bredouille indique des conditions, pas des champignons. Faites contrôler toute cueillette.`;

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function weekdayIndex(iso: string): number {
  return utc(iso).getUTCDay();
}

/** "jeudi 15 octobre". */
export function longDate(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}${NBSP}${MONTHS[d.getUTCMonth()]}`;
}

/** "jeu. 15" for the compact strip. */
export function shortDate(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAYS[d.getUTCDay()]!.slice(0, 3)}.${NBSP}${d.getUTCDate()}`;
}

/** "15 octobre 2026". */
export function fullDate(iso: string): string {
  const d = utc(iso);
  return `${d.getUTCDate()}${NBSP}${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "aujourd’hui", "demain" or "J+3", relative to `today`. */
export function relativeLabel(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return 'aujourd’hui';
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `J+${n}` : `J${n}`;
}

/** Today's date in Paris, as the map counts days. */
export function parisToday(now: Date = new Date()): string {
  // Paris is UTC+1 in winter and UTC+2 in summer: the last Sunday of March to the last Sunday of October, at 01:00 UTC.
  const y = now.getUTCFullYear();
  const lastSunday = (month: number): number => {
    const d = new Date(Date.UTC(y, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const summer = now.getTime() >= lastSunday(2) && now.getTime() < lastSunday(9);
  return new Date(now.getTime() + (summer ? 2 : 1) * 3_600_000).toISOString().slice(0, 10);
}

/** Lower case, no accents, no punctuation: for matching what people type. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´_-]/g, ' ')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** French spacing before « : ; ? ! » and inside guillemets, for text we build ourselves. */
export function frenchSpacing(s: string): string {
  return s
    .replace(/ ([:;?!»])/g, `${NBSP}$1`)
    .replace(/« /g, `«${NBSP}`);
}

export const pct = (share: number): string => `${Math.round(share * 100)}${NBSP}%`;
export const dec = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');
export const mm = (v: number): string => `${Math.round(v)}${NBSP}mm`;
export const deg = (v: number): string => `${dec(v, 1).replace(/,0$/, '')}${NBSP}°C`;
