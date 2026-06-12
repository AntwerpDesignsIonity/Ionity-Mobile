/**
 * Dev-only Node loader: lets you run the TypeScript sources directly (via
 * `node --experimental-strip-types`) before a build, even though the sources use
 * `.js` import specifiers (required for the compiled Node-ESM output). When a
 * relative `.js` specifier has no file on disk but a sibling `.ts` exists, this
 * redirects to the `.ts`.
 *
 * Usage:
 *   node --experimental-strip-types --import ./tools/strip-types-loader.mjs <file.ts>
 *
 * Not used in production — the build (tsc) emits real `.js` files.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./strip-types-resolve.mjs", import.meta.url);
