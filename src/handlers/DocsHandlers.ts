import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import {
    GUIDES,
    GuideNotFoundError,
    extractSection,
    guideById,
    guideIndex,
    guideUri,
    listSections,
    readGuideFile
} from '../lib/guides.js';

/**
 * Serves this server's own documentation as a tool.
 *
 * The same documents are exposed as MCP resources by the server, but resources
 * are typically attached by the *user* in a client's UI, so an agent will not
 * find them on its own. A tool is always in the agent's context, which makes
 * this the route that actually answers "how do I use this server" mid-task.
 *
 * Reading a whole guide is opt-in: with no arguments this returns an index of
 * guides and their section headings, which is what an agent should look at
 * first.
 */
export class DocsHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'readServerGuide',
                    annotations: {
                        title: 'Read server guide',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        "This server's own documentation. Call with no arguments for an index of the available " +
                        'guides and their sections, then request one section by number or title. Use it when ' +
                        'you are unsure which tool to use, what an argument means, how a workflow fits together, ' +
                        'or why a call is failing.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            guide: {
                                type: 'string',
                                // Derived from the registry, so a guide added there is
                                // described here without anyone remembering to.
                                description:
                                    `Which guide: ${GUIDES.map(g => `'${g.id}' (${g.title})`).join(', ')}. ` +
                                    'Omit for the index of all of them.',
                                enum: GUIDES.map(g => g.id)
                            },
                            section: {
                                type: 'string',
                                description:
                                    "A section of that guide, by number ('2.1') or by title ('golden paths'). " +
                                    'Strongly preferred over reading a whole guide.'
                            }
                        }
                    },
                    narrowingHint:
                        'Ask for one section instead of the whole guide: add a `section` argument, e.g. ' +
                        '{"guide":"tools","section":"1"}. Calling readServerGuide with no arguments lists ' +
                        'every guide and the sections each one has.'
                },
                onFailure: 'Failed to read the server guide',
                run: args => this.readServerGuide(args)
            }
        ];
    }

    /**
     * @description Returns the guide index, a whole guide, or one section of one.
     * @param args.guide - Guide id. Omit for the index.
     * @param args.section - Section number or title fragment.
     * @returns The requested documentation as markdown.
     * @throws {McpError} If the guide or section does not exist, or the file is unreadable.
     */
    private readServerGuide(args: any): Record<string, any> {
        const requested = args?.guide ? String(args.guide).trim().toLowerCase() : undefined;
        const section = args?.section ? String(args.section).trim() : undefined;

        try {
            // No guide named: hand back the cheap index rather than every document.
            if (!requested) {
                if (section) {
                    throw new McpError(
                        ErrorCode.InvalidParams,
                        `A section was requested without a guide. Name one of: ` +
                        `${GUIDES.map(g => g.id).join(', ')}.`
                    );
                }
                return {
                    guides: guideIndex(),
                    hint: 'Request a section with {guide, section}, e.g. {"guide":"tools","section":"1"}.'
                };
            }

            const guide = guideById(requested);
            if (!guide) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `There is no guide '${requested}'. Available: ${GUIDES.map(g => g.id).join(', ')}.`
                );
            }

            const markdown = readGuideFile(guide);

            if (!section) {
                return {
                    guide: guide.id,
                    title: guide.title,
                    uri: guideUri(guide.id),
                    bytes: Buffer.byteLength(markdown, 'utf8'),
                    sections: listSections(markdown).map(({ number, title, level }) => ({ number, title, level })),
                    content: markdown
                };
            }

            const found = extractSection(markdown, section);
            if (!found) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `Guide '${guide.id}' has no section matching '${section}'. Available sections: ` +
                    listSections(markdown)
                        .map(s => (s.number ? `${s.number} ${s.title}` : s.title))
                        .join(' | ')
                );
            }

            return {
                guide: guide.id,
                title: guide.title,
                uri: guideUri(guide.id),
                section: {
                    number: found.section.number,
                    title: found.section.title,
                    level: found.section.level
                },
                content: found.content
            };
        } catch (error) {
            // A guide that ships with the build but is not on disk is an installation
            // problem, not a bad argument — it keeps its own message.
            if (error instanceof GuideNotFoundError) {
                throw new McpError(ErrorCode.InternalError, error.message);
            }
            throw error;
        }
    }
}
