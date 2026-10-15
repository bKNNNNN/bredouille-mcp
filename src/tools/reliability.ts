import { dec, fullDate } from '../text';
import { failure, links, withFooter, type ToolContext, type ToolOutput } from './common';
import { isOutput, speciesOrRefusal } from './place';

const STATUS_FR: Readonly<Record<string, string>> = { verified: 'vérifié', to_confirm: 'à confirmer' };

/** Thresholds of « vérifié », read from the engine's own sentence so they never drift from the published rule. */
export function ruleText(rule: string | undefined): string | null {
  const m = /AUC\s*>=\s*([\d.]+),\s*95% CI lower bound\s*>=\s*([\d.]+)\s*and\s*n\s*>=\s*(\d+)/.exec(rule ?? '');
  if (!m) return null;
  return `Règle : « vérifié » quand le score atteint ${dec(Number(m[1]))}, que la borne basse de son intervalle à 95 % atteint ${dec(Number(m[2]))}, avec au moins ${m[3]} observations datées.`;
}

export async function fiabilite(ctx: ToolContext, input: { espece: string }): Promise<ToolOutput> {
  const l = links(ctx.siteUrl);
  const species = speciesOrRefusal(input.espece, l.reliability);
  if (isOutput(species)) return species;
  let acc;
  try {
    acc = await ctx.data.accuracy();
  } catch (error) {
    return failure(error, l.reliability);
  }
  const a = acc.species[species.code];
  if (!a) return { text: withFooter(`Pas encore de chiffres publiés pour les ${species.name.toLowerCase()}.`, l.reliability) };

  const status = STATUS_FR[a.confidence] ?? a.confidence;
  const lines = [`${species.name} : indice ${status}.`, ''];
  const shown = a.index?.index_shown;
  if (shown) {
    const score100 = Math.round(shown.auc * 100);
    lines.push(
      `- Score : ${dec(shown.auc)} (intervalle à 95 % : ${dec(shown.auc_ci95[0])} à ${dec(shown.auc_ci95[1])}), sur ${shown.n} observations datées (GBIF, ${acc.period[0]}-${acc.period[1]}).`,
      `- Lecture : le jour réel d’une trouvaille était mieux classé que ${score100} jours témoins sur 100 au même lieu. 50 sur 100, c’est le hasard.`,
      `- ${Math.round(shown.lift_top_decile * 10)} % des trouvailles tombent dans les 10 % de jours les mieux classés de leur lieu (10 % attendus par hasard).`,
    );
  } else {
    lines.push('- Pas assez d’observations datées pour calculer un score.');
  }
  const regions = Object.values(a.regions);
  const verified = regions.filter((r) => r.confidence === 'verified').map((r) => r.name);
  if (regions.length) {
    lines.push(`- Régions : ${verified.length ? `vérifié pour ${verified.join(', ')}` : 'aucune région vérifiée'} ; à confirmer ailleurs (${regions.length - verified.length} région${regions.length - verified.length > 1 ? 's' : ''}).`);
  }
  const skill = acc.forecast_skill?.species?.[species.code] ?? [];
  const leads = [3, 7].map((n) => skill.find((s) => s.lead_days === n)?.label_fr).filter((s): s is string => Boolean(s));
  if (leads.length) lines.push(`- Prévisions : ${leads.join(' ')}`);
  const rule = ruleText(acc.method?.confidence_rule);
  if (rule) lines.push('', rule);
  lines.push(`Chiffres du back-test publié le ${fullDate(acc.generated_at.slice(0, 10))}. Méthode complète : ${l.reliability}`);
  return { text: withFooter(lines.join('\n'), l.species(species)) };
}
