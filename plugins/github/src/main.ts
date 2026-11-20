/**
 * The github plugin: the pull requests of a session, as the Pull requests
 * fold under it and a mark on its row, kept fresh from gh and told of on
 * the row when they change.
 */

import { serve } from "./serve.js";

await serve();

// The loop is over, and standard input is what holds the process up, so
// letting go of it is the plugin going when it was told to.
process.stdin.unref();
