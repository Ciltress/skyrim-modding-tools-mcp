#!/usr/bin/env node

/**
 * The entry point, and only the entry point.
 *
 * The server itself lives in ./server.ts. It is split off because this file runs
 * on import — it loads .env, builds a server and connects it to a transport
 * (stdio by default, or Streamable HTTP when `MCP_TRANSPORT=http`) — and a
 * module that does that cannot be imported by a test.
 *
 * The path does not move: package.json `main` and `bin`, `npm
 * start` and every registered MCP client all run dist/index.js.
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppServer } from './server.js';

// The build emits ESM, which has no __dirname; import.meta.url is the equivalent.
const HERE = path.dirname(fileURLToPath(import.meta.url));

// quiet, because dotenv announces what it loaded, and up to 17.x it did so with
// console.log — on stdout, ahead of the first protocol frame. 18 moved the line
// to stderr; this keeps it off both rather than depending on which is installed.
config({ path: path.resolve(HERE, '../.env'), quiet: true });

export { AppServer } from './server.js';
export type { ServerDependencies } from './server.js';

const server = new AppServer();
server.run().catch((error) => {
  // The message carries the diagnosis assembled by explainStartupFailure() and
  // can run to several lines. Printing the Error object as well buries it under
  // a stack that says only that a connect failed, which was never the question.
  console.error(`Failed to start MCP server: ${error?.message ?? error}`);
  if (error?.cause?.stack) console.error(error.cause.stack);
  process.exit(1);
});
