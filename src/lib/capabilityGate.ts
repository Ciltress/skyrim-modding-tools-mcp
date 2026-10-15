/**
 * Withholding tools the connected backend cannot serve.
 *
 * Backends differ: one installation has a plugin, an optional module or a newer
 * API version, another does not. A tool offered against a backend that lacks
 * what it needs can only ever fail, and the failure usually reads as "Request
 * failed with status code 400" — which tells an agent nothing, so it retries.
 *
 * Deleting such tools is the wrong fix: the feature exists on plenty of
 * backends, and hard-coding one installation's gaps turns a general server into
 * a local one. The backend already knows what it supports; ask it, through
 * `Backend.capabilities()`.
 *
 * Gating is decided once, before tools/list is answered, so no client needs to
 * support tools/list_changed. When capabilities cannot be read — no session,
 * backend down, a backend that cannot say — nothing is gated. Offering a tool
 * that might not work beats hiding one that would.
 */

import type { ToolDefinition } from '../types/tools.js';

export interface GatedFeature {
    /** Stable id, as the backend reports it and as `ToolDefinition.needsFeature` names it. */
    id: string;
    /** Human-readable name of what is missing, for the message and healthcheck. */
    label: string;
}

/**
 * The optional features a backend may or may not offer. None yet: every tool so far works against
 * any instance this server can open. The Nexus tools will need some — an API key, a premium account.
 *
 * Which tools need one is declared by the tools themselves, through
 * `ToolDefinition.needsFeature`, never as a list of names here — a renamed tool
 * would leave its old name behind and quietly come back to life on a backend
 * that cannot serve it. capabilityGate.test.ts checks every `needsFeature` names
 * a feature listed here, so a typo cannot un-gate a tool either.
 */
export const GATED_FEATURES: readonly GatedFeature[] = [];

export interface GateResult {
    /** Tool name -> why it is not offered here. */
    unavailable: Map<string, string>;
    /** Ids of the features found missing. */
    missing: string[];
}

/**
 * Works out which tools this backend cannot serve.
 *
 * Undefined or empty capabilities gate nothing, deliberately: the failure mode
 * of a wrong "missing" verdict is a capability silently disappearing, which is
 * far harder to diagnose than a tool that returns an error.
 *
 * @param capabilities What the backend reported it supports.
 * @param tools        The catalogue. A tool is withheld when its `needsFeature`
 *                     names a feature this backend does not have.
 */
export function evaluateGate(
    capabilities: readonly string[] | undefined,
    tools: readonly ToolDefinition[] = [],
    features: readonly GatedFeature[] = GATED_FEATURES
): GateResult {
    const unavailable = new Map<string, string>();
    const missing: string[] = [];

    if (!Array.isArray(capabilities) || !capabilities.length) return { unavailable, missing };
    const supported = new Set(capabilities.map(id => String(id).toLowerCase()));

    for (const feature of features) {
        if (supported.has(feature.id.toLowerCase())) continue;

        missing.push(feature.id);
        for (const tool of tools) {
            if (tool.needsFeature !== feature.id) continue;
            unavailable.set(
                tool.name,
                `This backend does not offer ${feature.label}, so '${tool.name}' cannot work here. This is ` +
                `a property of the backend, not of your request: calling it again will not help.`
            );
        }
    }

    return { unavailable, missing };
}

/** MCP_GATE=off skips asking the backend entirely. */
export function gatingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = String(env.MCP_GATE ?? '').trim().toLowerCase();
    return !['off', 'false', '0', 'no'].includes(raw);
}
