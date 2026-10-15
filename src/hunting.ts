import data from './data/hunting-2026-2027.json';
import { fold } from './text';

/**
 * General hunting season dates per département, read in the 2026-2027
 * prefectoral arrêtés (public documents). Snapshot bundled with sources;
 * a null date means « not read », never « none ».
 */
export interface HuntingDept {
  readonly code: string;
  readonly name: string;
  readonly opening: string | null;
  readonly closing: string | null;
  readonly noHuntingDays: string | null;
  readonly source: { readonly url: string; readonly kind: string } | null;
  readonly ocr: boolean;
  readonly prefectureHunting: string | null;
  readonly prefecture: string | null;
}

interface HuntingFile {
  readonly season: string;
  readonly checkedOn: string;
  readonly method: string;
  readonly licence: string;
  readonly departements: readonly HuntingDept[];
}

export const HUNTING = data as unknown as HuntingFile;

/** The national frame, Code de l’environnement (Légifrance). */
export const HUNTING_NATIONAL = [
  {
    text: 'Le préfet fixe chaque année par arrêté les dates d’ouverture et de clôture de la chasse dans son département.',
    source: 'Code de l’environnement, article R424-6',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044622400',
  },
  {
    text: 'La clôture générale a lieu au plus tard le dernier jour de février. Certaines espèces, comme le sanglier, ont des périodes plus longues.',
    source: 'Code de l’environnement, article R424-7',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000025797341',
  },
] as const;

export const ONF_CALENDARS = 'https://www.onf.fr/chasse/les-calendriers-de-chasse-en-foret-domaniale';

const BY_NAME: ReadonlyMap<string, HuntingDept> = new Map(HUNTING.departements.map((d) => [fold(d.name), d]));

/** « 19 », « 2A », « Corrèze », « correze », « la Corrèze », « 19 - Corrèze ». */
export function resolveDept(input: string): HuntingDept | null {
  const raw = input.trim().toUpperCase();
  const codeMatch = /^(2A|2B|\d{1,2})\b/.exec(raw);
  if (codeMatch) {
    const code = codeMatch[1]!.length === 1 ? `0${codeMatch[1]}` : codeMatch[1]!;
    const byCode = HUNTING.departements.find((d) => d.code === code);
    if (byCode) return byCode;
  }
  const f = fold(input)
    .replace(/^(departement|dept|dpt)( de la| du| des| de l| de| d)? /, '')
    .replace(/^(la|le|les|l) /, '');
  return BY_NAME.get(f) ?? null;
}

export function deptByCode(code: string): HuntingDept | null {
  return HUNTING.departements.find((d) => d.code === code) ?? null;
}

export type SeasonStatus = 'open' | 'closed' | 'unknown';

export function seasonStatus(d: Pick<HuntingDept, 'opening' | 'closing'>, today: string): SeasonStatus {
  if (!d.opening || !d.closing) return 'unknown';
  return today >= d.opening && today <= d.closing ? 'open' : 'closed';
}
