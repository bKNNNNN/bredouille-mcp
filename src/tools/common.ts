import type { DataSource } from '../bredouille';
import type { SpeciesInfo } from '../species';
import { frenchSpacing, SAFETY_LINE } from '../text';
import { UpstreamError } from '../upstream';

export interface ToolContext {
  readonly data: DataSource;
  readonly siteUrl: string;
  readonly now: () => Date;
}

export interface ToolOutput {
  readonly text: string;
  readonly structured?: Record<string, unknown>;
  readonly isError?: boolean;
}

export const links = (site: string) => {
  const base = site.replace(/\/+$/, '');
  return {
    map: `${base}/#carte`,
    species: (s: SpeciesInfo) => `${base}/especes/${s.slug}/`,
    hub: (s: SpeciesInfo) => `${base}/champignons/${s.slug}/`,
    reliability: `${base}/fiabilite/`,
    howToRead: `${base}/comment-lire-la-carte/`,
    safety: `${base}/securite/`,
  };
};

/** Every answer ends the same way: the safety line, then the matching page. */
export function withFooter(body: string, url: string): string {
  return frenchSpacing(`${body.trim()}\n\n${SAFETY_LINE}\nSur bredouille.app : ${url}`);
}

export function refusal(text: string, url: string): ToolOutput {
  return { text: withFooter(text, url), isError: false };
}

/** Upstream failures become a short French sentence; anything else is rethrown. */
export function failure(error: unknown, url: string): ToolOutput {
  if (error instanceof UpstreamError) {
    if (error.detail) console.warn('[upstream]', error.kind, error.detail);
    const tail = error.message.includes('Réessayez') ? '' : ' Réessayez plus tard.';
    return { text: withFooter(`${error.message}${tail}`, url), isError: true };
  }
  throw error;
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
