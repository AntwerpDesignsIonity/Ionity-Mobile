/** Resolve hook: redirect relative `.js` specifiers to a sibling `.ts` when the
 *  `.js` file does not exist (dev-only, see strip-types-loader.mjs). */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const tsCandidate = pathResolve(dirname(parent), specifier.replace(/\.js$/, ".ts"));
    const jsCandidate = pathResolve(dirname(parent), specifier);
    if (!existsSync(jsCandidate) && existsSync(tsCandidate)) {
      return nextResolve(pathToFileURL(tsCandidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
