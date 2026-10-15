import { inMetropole, OUTSIDE_TEXT } from '../domain';
import { resolveSpecies, speciesNames, type SpeciesInfo } from '../species';
import { refusal, type ToolContext, type ToolOutput } from './common';

/** « Tulle (Corrèze) », or null when the commune lookup fails: the place name is a nicety, never a blocker. */
export async function placeLabel(ctx: ToolContext, lat: number, lon: number): Promise<string | null> {
  try {
    const [c] = await ctx.data.communeAt(lat, lon);
    if (!c) return null;
    return c.departement ? `${c.nom} (${c.departement.nom})` : c.nom;
  } catch {
    return null;
  }
}

export function checkPlace(lat: number, lon: number, url: string): ToolOutput | null {
  return inMetropole(lat, lon) ? null : refusal(OUTSIDE_TEXT, url);
}

export function unknownSpecies(input: string, url: string): ToolOutput {
  return refusal(`Espèce inconnue de Bredouille (« ${input.slice(0, 60)} »). Espèces suivies : ${speciesNames()}.`, url);
}

export function speciesOrRefusal(input: string, url: string): SpeciesInfo | ToolOutput {
  return resolveSpecies(input) ?? unknownSpecies(input, url);
}

export const isOutput = (x: unknown): x is ToolOutput => typeof x === 'object' && x !== null && 'text' in x;
