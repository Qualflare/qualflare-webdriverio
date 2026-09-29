/** Getting a default-exported class across the ESM/CJS boundary.
 *
 * This file exists because of one concrete failure, not as defensive
 * decoration: `class X extends BaseFromAnotherPackage` compiled fine, passed
 * every unit test, ran correctly from the ESM build, and then threw
 *
 *   TypeError: Class extends value #<Object> is not a constructor or null
 *
 * the first time real Jest loaded the CJS build from a CommonJS jest.config.
 *
 * The mechanism: this package ships both formats, and for the CJS output esbuild
 * emits `__toESM(require("@wdio/reporter"), 1)`. That second argument
 * is `isNodeMode`, and it makes the helper set `default` to the ENTIRE module
 * object for Node interop — so when the dependency is itself an ESM-to-CJS build
 * exporting `{ __esModule: true, default: class }`, the result is
 * `{ default: { default: class } }` and `.default` is an object, not the class.
 * The ESM build resolves the dependency's real `export default` and is
 * unaffected, which is exactly why testing one format proved nothing about the
 * other.
 *
 * Copied from @qualflare/detox, where it was found. Here the base class is
 * WDIOReporter, whose CJS build is exactly that `{ __esModule, default }` shape;
 * test/built/both-formats.test.ts reproduced the error before this was used.
 */

/** Unwraps nested `default` properties until it reaches the exported value.
 *
 * Loops rather than checking one level, because the number of wraps depends on
 * which of the two builds is running and on interop decisions in a dependency's
 * bundler that this package does not control. A class or function is never an
 * unwrappable object, so the loop stops on the thing being looked for.
 *
 * Returns the input unchanged when there is no `default` to unwrap, which covers
 * a plain CommonJS dependency assigning `module.exports = class`.
 */
export function resolveDefaultExport(moduleExports: unknown): unknown {
  let current = moduleExports;
  // Bounded: an interop wrapper is one or two levels deep, and a cycle through
  // self-referential `default` properties must not hang a reporter's import.
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) return current;
    if (!('default' in current)) return current;
    const next = (current as { default: unknown }).default;
    if (next === current) return current;
    current = next;
  }
  return current;
}
