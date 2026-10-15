/**
 * End-user identifiers that MCP hosts pass with a request, used only to key the
 * per-user rate limit. Each one is hashed before use and never logged.
 *
 * - ChatGPT (Apps SDK) sends `_meta["openai/subject"]` (anonymized user id, documented
 *   "for the purposes of rate limiting and identification") and `_meta["openai/session"]`
 *   (anonymized conversation id) on tool calls.
 * - The MCP spec's `Mcp-Session-Id` header only comes back if the server issued one at
 *   initialization. This server is stateless and issues none, so compliant clients do not
 *   send it; it is read for clients that send one anyway.
 * - Claude documents no per-user identifier for servers without sign-in.
 */

/** Methods counted by the per-user limit and the daily cap message. */
export const METERED_METHODS: ReadonlySet<string> = new Set(['tools/call', 'resources/read']);

export interface RpcMessage {
  readonly method?: unknown;
  readonly id?: unknown;
  readonly params?: { readonly _meta?: Readonly<Record<string, unknown>> } & Readonly<Record<string, unknown>>;
}

export type IdentifierKind = 'openai-subject' | 'openai-session' | 'mcp-session';

export interface UserIdentifier {
  readonly kind: IdentifierKind;
  readonly value: string;
}

const MAX_IDENTIFIER_LENGTH = 512;

function usable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 && v.length <= MAX_IDENTIFIER_LENGTH ? v : null;
}

/** The JSON-RPC messages of a body (single or batch); empty when it is not JSON-RPC. */
export function parseMessages(body: string): readonly RpcMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter((m): m is RpcMessage => typeof m === 'object' && m !== null && !Array.isArray(m));
}

export const isMetered = (m: RpcMessage): boolean => typeof m.method === 'string' && METERED_METHODS.has(m.method);

/** The most specific identifier available: user, then conversation, then MCP session. */
export function userIdentifier(message: RpcMessage, headers: Headers): UserIdentifier | null {
  const meta = message.params?._meta;
  const subject = usable(meta?.['openai/subject']);
  if (subject) return { kind: 'openai-subject', value: subject };
  const session = usable(meta?.['openai/session']);
  if (session) return { kind: 'openai-session', value: session };
  const mcpSession = usable(headers.get('mcp-session-id'));
  if (mcpSession) return { kind: 'mcp-session', value: mcpSession };
  return null;
}
