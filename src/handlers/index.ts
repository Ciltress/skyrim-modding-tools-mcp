import type { AppBackend } from '../backend/index.js';
import type { BaseHandler } from './BaseHandler.js';
import { DocsHandlers } from './DocsHandlers.js';
import { NexusHandlers } from './NexusHandlers.js';
import { ProjectsHandlers } from './ProjectsHandlers.js';
import { RecordsHandlers } from './RecordsHandlers.js';
import { SkillsHandlers } from './SkillsHandlers.js';

export { BaseHandler } from './BaseHandler.js';
export type { ToolSpec } from './BaseHandler.js';
export { DocsHandlers, NexusHandlers, ProjectsHandlers, RecordsHandlers, SkillsHandlers };

/**
 * Every handler, in tools/list order — the one list.
 *
 * The server serves exactly these, the tool reference documents exactly these
 * (lib/toolDocs.ts), and the contract tests hold exactly these to the contract.
 * A handler that is not here is not served, not documented and not tested, so
 * forgetting it cannot leave the three disagreeing.
 */
export function createHandlers(backend: AppBackend): BaseHandler[] {
    return [
        new DocsHandlers(backend),
        new SkillsHandlers(backend),
        new RecordsHandlers(backend),
        new ProjectsHandlers(backend),
        new NexusHandlers(backend)
    ];
}
