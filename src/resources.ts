import type { DataSource } from './bredouille';
import { DEFAULT_CLASSES } from './domain';
import type { Manifest } from './schemas';
import { SPECIES } from './species';
import { frenchSpacing, SAFETY_LINE } from './text';

export const SPECIES_URI = 'bredouille://especes';
export const HOW_TO_READ_URI = 'bredouille://lire-l-indice';

const CONFIDENCE_FR: Readonly<Record<string, string>> = { verified: 'vérifié', to_confirm: 'à confirmer' };

/** Species codes and French names; status from the live manifest when it answers. */
export async function speciesResource(data: DataSource, site: string): Promise<string> {
  let manifest: Manifest | null = null;
  try {
    manifest = await data.manifest();
  } catch {
    manifest = null;
  }
  const lines = ['# Espèces suivies par Bredouille', '', 'code | nom | nom latin | indice | fiche'];
  for (const s of SPECIES) {
    const m = manifest?.manifest.species.find((x) => x.code === s.code);
    const status = m ? (CONFIDENCE_FR[m.confidence] ?? m.confidence) : 'inconnu';
    lines.push(`${s.code} | ${s.name} | ${s.latin} | ${status} | ${site}/especes/${s.slug}/`);
  }
  lines.push('', 'Les outils acceptent le code ou le nom français, au singulier ou au pluriel.', '', SAFETY_LINE, `Sur bredouille.app : ${site}/especes/`);
  return frenchSpacing(lines.join('\n'));
}

export function howToReadResource(site: string): string {
  const classes = DEFAULT_CLASSES.map((c) => `- ${c.min} à ${c.max} : ${c.label_fr}`).join('\n');
  return frenchSpacing(`# Lire l’indice Bredouille

L’indice va de 0 à 100 pour une espèce, un jour et une cellule de 1 km. Il compare la météo récente (pluie des semaines précédentes, humidité du sol, température) à ce qui est habituel à ce lieu et à cette date, puis tient compte de l’habitat (forêt, altitude).

Classes :
${classes}
- 0 : rien à signaler (habitat peu favorable, ou hors saison)

Ce que l’indice ne dit pas :
- Il ne dit pas qu’il y a des champignons, ni où exactement.
- Il ne dit pas qu’un champignon est comestible. Bredouille ne fait aucune identification.
- Les jours à venir reposent sur des prévisions météo : plus le jour est loin, plus il peut changer.
- Certaines espèces ont un indice « à confirmer » : le back-test sur les observations datées ne suffit pas encore.

Sources : Météo-France (SIM2, ARPEGE), ECMWF (IFS open data), Copernicus, GBIF. Indice publié sous licence CC BY 4.0 par Bredouille.
Détails : ${site}/comment-lire-la-carte/ et ${site}/fiabilite/

${SAFETY_LINE}`);
}
