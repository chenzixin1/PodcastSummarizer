'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AppFrame from '../../../components/AppFrame';

interface McpTokenRow {
  id: string;
  tokenPrefix: string;
  name: string;
  vaultLabel: string | null;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface McpTokenPayload {
  endpointUrl: string;
  scopes: string[];
  defaultScopes: string[];
  tokens: McpTokenRow[];
}

const scopeLabels: Record<string, string> = {
  'podcasts:list': 'List podcasts',
  'podcasts:read': 'Read podcasts',
  'analysis:read': 'Read analysis',
  'exports:markdown': 'Export Markdown',
  'account:credits:read': 'Read credits',
  'qa:ask': 'Podcast Q&A',
  'podcasts:upload': 'Upload SRT',
  'podcasts:write_metadata': 'Edit metadata',
  'jobs:enqueue': 'Retry processing',
};

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function isTokenActive(token: McpTokenRow): boolean {
  if (token.revokedAt) {
    return false;
  }
  if (!token.expiresAt) {
    return true;
  }
  return new Date(token.expiresAt).getTime() > Date.now();
}

export default function AccountMcpPage() {
  const { status } = useSession();
  const router = useRouter();
  const [payload, setPayload] = useState<McpTokenPayload | null>(null);
  const [name, setName] = useState('Obsidian');
  const [vaultLabel, setVaultLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('180');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const activeTokens = useMemo(
    () => (payload?.tokens || []).filter((token) => isTokenActive(token)),
    [payload],
  );

  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/account/mcp/tokens', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load MCP settings');
      }
      setPayload(result.data);
      if (selectedScopes.length === 0 && Array.isArray(result.data?.defaultScopes)) {
        setSelectedScopes(result.data.defaultScopes);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedScopes.length]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin?callbackUrl=/account/mcp');
    }
  }, [router, status]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadTokens();
    }
  }, [loadTokens, status]);

  function toggleScope(scope: string) {
    setSelectedScopes((current) => {
      if (current.includes(scope)) {
        return current.filter((item) => item !== scope);
      }
      return [...current, scope];
    });
  }

  async function createToken() {
    setError(null);
    setCopyStatus(null);
    setNewToken(null);
    setIsCreating(true);
    try {
      const response = await fetch('/api/account/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          vaultLabel,
          expiresInDays: Number(expiresInDays),
          scopes: selectedScopes,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create MCP token');
      }
      setNewToken(result.data.token);
      await loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function revokeToken(token: McpTokenRow) {
    setError(null);
    const response = await fetch(`/api/account/mcp/tokens/${encodeURIComponent(token.id)}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      setError(result.error || 'Failed to revoke MCP token');
      return;
    }
    await loadTokens();
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${label} copied`);
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <AppFrame currentLabel="MCP" showViewTabs={false} mainClassName="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center text-[var(--text-muted)]">Loading...</div>
      </AppFrame>
    );
  }

  const endpointUrl = payload?.endpointUrl || 'https://podsum.cc/mcp';
  const agentSetupText = `PodSum.cc MCP setup for an agent:

Server name: podsum
Transport: Streamable HTTP / JSON-RPC over HTTPS
Endpoint URL: ${endpointUrl}
Authentication header: Authorization: Bearer <YOUR_PODSUM_MCP_TOKEN>

Configuration example:
{
  "mcpServers": {
    "podsum": {
      "type": "streamable-http",
      "url": "${endpointUrl}",
      "headers": {
        "Authorization": "Bearer <YOUR_PODSUM_MCP_TOKEN>"
      }
    }
  }
}

Token instructions:
1. Create a token on this page.
2. Copy the token once when it is shown.
3. Store it as a local secret for the agent. Do not store it inside Obsidian notes.
4. Replace <YOUR_PODSUM_MCP_TOKEN> with that token.

Recommended Obsidian scopes:
- podcasts:list
- podcasts:read
- analysis:read
- exports:markdown

Optional read-only scope:
- account:credits:read

Available tools:
- podsum_list_podcasts: input { "limit": 10, "query": "" }
- podsum_get_podcast: input { "podcastId": "<podcast_id>" }
- podsum_export_markdown: input { "podcastId": "<podcast_id>", "language": "auto" }
- podsum_get_credits: input {}

Safety rules:
- Treat this as a read-oriented Obsidian integration.
- Prefer podsum_export_markdown when writing podcast notes into Obsidian.
- Never expose the bearer token in a note, prompt, screenshot, or shared log.
- If authentication fails, ask the user to create a new token from ${typeof window === 'undefined' ? 'https://podsum.cc/account/mcp' : window.location.origin + '/account/mcp'}.`;

  return (
    <AppFrame currentLabel="MCP" showViewTabs={false}>
        <div className="space-y-5">
          {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}
          {copyStatus && <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--heading)]">{copyStatus}</div>}

          <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="dashboard-panel rounded-lg p-5">
              <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">MCP endpoint</div>
              <div className="mt-2 break-all rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-3 font-mono text-sm text-[var(--text-main)]">
                {endpointUrl}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => copyText(endpointUrl, 'Endpoint')} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">
                  Copy endpoint
                </button>
                <button onClick={() => copyText('Authorization: Bearer <token>', 'Header')} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">
                  Copy header format
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-muted)] p-3 text-sm text-[var(--text-secondary)]">
                Active tokens: <span className="font-semibold text-[var(--heading)]">{activeTokens.length}</span>
              </div>
            </div>

            <div className="dashboard-panel rounded-lg p-5">
              <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">Create token</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
                </label>
                <label>
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Vault label</span>
                  <input value={vaultLabel} onChange={(event) => setVaultLabel(event.target.value)} placeholder="Obsidian vault" className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]" />
                </label>
                <label>
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Expires</span>
                  <select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm outline-none focus:border-[var(--border-medium)]">
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="180">180 days</option>
                    <option value="365">365 days</option>
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">Scopes</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(payload?.scopes || []).map((scope) => (
                    <label key={scope} className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        className="h-4 w-4"
                      />
                      <span>{scopeLabels[scope] || scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={createToken}
                disabled={isCreating || selectedScopes.length === 0}
                className="mt-4 rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create MCP token'}
              </button>
            </div>
          </section>

          <section className="dashboard-panel rounded-lg p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">Agent setup text</div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Copy this block into an agent or Obsidian MCP client setup prompt.</p>
              </div>
              <button onClick={() => copyText(agentSetupText, 'Agent setup text')} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">
                Copy setup text
              </button>
            </div>
            <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-4 font-mono text-xs leading-5 text-[var(--text-main)]">
              {agentSetupText}
            </pre>
          </section>

          {newToken && (
            <section className="dashboard-panel rounded-lg border-[#d8c18f] p-5">
              <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">New token</div>
              <div className="mt-2 break-all rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-3 font-mono text-sm">
                {newToken}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => copyText(newToken, 'Token')} className="rounded-lg bg-[var(--btn-primary)] px-3 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">
                  Copy token
                </button>
                <button onClick={() => setNewToken(null)} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">
                  Hide
                </button>
              </div>
            </section>
          )}

          <section className="dashboard-panel overflow-x-auto rounded-lg">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border-soft)] bg-[var(--table-head-bg)] text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Scopes</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last used</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
                ) : (payload?.tokens || []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No MCP tokens yet.</td></tr>
                ) : (
                  (payload?.tokens || []).map((token) => {
                    const active = isTokenActive(token);
                    return (
                      <tr key={token.id} className="border-b border-[var(--border-soft)] align-top">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[var(--heading)]">{token.name}</div>
                          <div className="text-xs text-[var(--text-muted)]">psm_{token.tokenPrefix}_...</div>
                          <div className="text-xs text-[var(--text-muted)]">{token.vaultLabel || 'No vault label'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-lg flex-wrap gap-1.5">
                            {token.scopes.map((scope) => (
                              <span key={scope} className="rounded-md border border-[var(--border-soft)] bg-[var(--paper-base)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                                {scope}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className={active ? 'font-semibold text-emerald-700' : 'font-semibold text-[var(--danger)]'}>{active ? 'active' : 'inactive'}</div>
                          <div className="text-xs text-[var(--text-muted)]">expires {formatDate(token.expiresAt)}</div>
                          {token.revokedAt && <div className="text-xs text-[var(--text-muted)]">revoked {formatDate(token.revokedAt)}</div>}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">{formatDate(token.lastUsedAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => revokeToken(token)}
                            disabled={!active}
                            className="rounded-lg border border-[#d8b7b7] bg-[var(--paper-base)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </div>
    </AppFrame>
  );
}
