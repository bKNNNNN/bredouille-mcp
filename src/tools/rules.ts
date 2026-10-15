import { HUNTING, HUNTING_NATIONAL, ONF_CALENDARS, resolveDept, seasonStatus, type HuntingDept } from '../hunting';
import type { RuleRecord, Rules } from '../schemas';
import { fullDate, parisToday } from '../text';
import { links, refusal, withFooter, type ToolContext, type ToolOutput } from './common';

const typo = (s: string): string => s.replace(/'/g, '’');
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const CHECK_PREFECTURE = 'à vérifier en préfecture';
const FALLBACK_DISCLAIMER =
  'Ces informations sont données à titre indicatif et peuvent être incomplètes ou dépassées. Elles ne valent pas autorisation. Seuls le propriétaire du terrain et les textes en vigueur font foi. Vérifiez les panneaux sur place et l’arrêté de votre département avant de cueillir.';

const STATUS_FR: Readonly<Record<string, string>> = {
  en_vigueur: 'texte en vigueur',
  projet: 'projet, non signé',
  a_verifier: 'texte ancien, en vigueur à vérifier',
  abroge: 'texte abrogé',
  aucun_arrete_trouve: 'aucun arrêté trouvé',
};
const ORDER: Readonly<Record<string, number>> = { en_vigueur: 0, a_verifier: 1, aucun_arrete_trouve: 2, projet: 3, abroge: 4 };

/** A rule checked more than 13 months ago is not shown as current. */
export function isStale(checkedAt: string, today: string): boolean {
  const [y, m, d] = checkedAt.split('-').map(Number) as [number, number, number];
  return new Date(`${today}T00:00:00Z`) > new Date(Date.UTC(y, m - 1 + 13, d));
}

function limitText(limit: RuleRecord['limit']): string | null {
  if (!limit) return null;
  const unit = limit.unit === 'L' ? (limit.value > 1 ? 'litres' : 'litre') : limit.unit;
  const per = limit.per === 'personne_jour' ? 'par personne et par jour' : 'par personne';
  return `${String(limit.value).replace('.', ',')} ${unit} ${per}`;
}

export function ruleLines(records: readonly RuleRecord[], today: string): string[] {
  return [...records]
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
    .flatMap((r) => {
      const stale = isStale(r.checked_at, today) ? ' Information non vérifiée récemment.' : '';
      const limit = limitText(r.limit);
      const tools = r.forbidden_tools.length ? `Outils interdits : ${r.forbidden_tools.join(', ')}.` : null;
      const days = r.forbidden_days.length ? `Jours interdits : ${r.forbidden_days.join(', ')}.` : null;
      return [
        `- ${typo(r.title)} (${STATUS_FR[r.status] ?? r.status}${r.signed_on ? `, signé le ${fullDate(r.signed_on)}` : ''}).${stale}`,
        `  ${typo(r.summary_fr)}`,
        ...(limit ? [`  Limite : ${limit}.`] : []),
        ...(tools ? [`  ${tools}`] : []),
        ...(days ? [`  ${days}`] : []),
        `  Portée : ${r.scope.label}. Source : ${r.source_name ?? 'non précisée'}${r.source_url?.startsWith('https://') ? `, ${r.source_url}` : ''} (vérifié le ${fullDate(r.checked_at)}).`,
      ];
    });
}

export function huntingLines(d: HuntingDept, today: string): string[] {
  const status = seasonStatus(d, today);
  const dates =
    d.opening && d.closing
      ? `ouverture générale le ${fullDate(d.opening)}, clôture générale le ${fullDate(d.closing)}.${status === 'open' ? ' La chasse est ouverte aujourd’hui.' : status === 'closed' ? ' Aujourd’hui est hors de la période générale.' : ''}`
      : `dates ${CHECK_PREFECTURE} (non lues dans l’arrêté).`;
  const lines = [`Chasse ${HUNTING.season} : ${dates}`];
  if (d.opening && d.closing) lines.push('Certaines espèces, comme le sanglier, peuvent être chassées hors de ces dates.');
  lines.push(d.noHuntingDays ? `Jours sans chasse : ${lowerFirst(d.noHuntingDays)}.` : `Jours sans chasse : ${CHECK_PREFECTURE}.`);
  if (d.ocr) lines.push('L’arrêté lu est un scan : un chiffre peut être faux, vérifiez sur le texte.');
  if (d.source) lines.push(`Source : ${d.source.kind === 'prefecture' ? 'arrêté sur le site de la préfecture' : 'copie de l’arrêté publiée par la Fédération nationale des chasseurs'}, ${d.source.url}`);
  const pref = d.prefectureHunting ?? d.prefecture;
  if (pref) lines.push(`Préfecture : ${pref}`);
  lines.push(`Battues en forêt domaniale : calendriers de l’ONF, ${ONF_CALENDARS}`);
  return lines;
}

export async function reglesEtChasse(ctx: ToolContext, input: { departement: string }): Promise<ToolOutput> {
  const l = links(ctx.siteUrl);
  const dept = resolveDept(input.departement);
  if (!dept) {
    return refusal(`Département non reconnu (« ${input.departement.slice(0, 60)} »). Donnez un numéro (19, 2A) ou un nom (Corrèze) de France métropolitaine.`, l.safety);
  }
  const today = parisToday(ctx.now());
  let rules: Rules | null = null;
  try {
    rules = await ctx.data.rules();
  } catch (error) {
    console.warn('[rules]', error instanceof Error ? error.name : 'unknown');
    rules = null;
  }
  const records = rules?.records.filter((r) => r.dept === dept.code) ?? [];
  const lines = [`${dept.name} (${dept.code})`, '', 'Cueillette des champignons :'];
  if (rules === null) lines.push(`- Règles indisponibles pour le moment : ${CHECK_PREFECTURE} et auprès du propriétaire.`);
  else if (records.length === 0) lines.push(`- Aucun arrêté relevé par Bredouille pour ce département. Cela ne veut pas dire qu’il n’y en a pas : ${CHECK_PREFECTURE} et en mairie.`);
  else lines.push(...ruleLines(records, today));
  lines.push((rules?.disclaimer_fr ?? FALLBACK_DISCLAIMER).replace(/'/g, '’'));
  lines.push('', ...huntingLines(dept, today), '', ...HUNTING_NATIONAL.map((n) => `${n.text} (${n.source}, ${n.url})`));
  lines.push(`Dates de chasse relevées le ${fullDate(HUNTING.checkedOn)}.`);
  return { text: withFooter(lines.join('\n'), l.safety) };
}
