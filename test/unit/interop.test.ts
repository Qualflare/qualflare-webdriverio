import { describe, expect, it } from 'vitest';

import { resolveDefaultExport } from '../../src/interop.js';

class Base {}

describe('resolveDefaultExport', () => {
  // The shape the ESM build sees: a real module namespace.
  it('unwraps one level', () => {
    expect(resolveDefaultExport({ default: Base, __esModule: true })).toBe(Base);
  });

  // The shape the CJS build sees, and the one that actually broke: esbuild's
  // __toESM(mod, isNodeMode=1) sets default to the whole module object, so an
  // ESM-to-CJS dependency ends up double-wrapped.
  it('unwraps the double wrap that broke real Jest', () => {
    const inner = { default: Base, __esModule: true };
    expect(resolveDefaultExport({ default: inner, __esModule: true })).toBe(Base);
  });

  // A plain CommonJS dependency doing `module.exports = class`.
  it('returns a bare class untouched', () => {
    expect(resolveDefaultExport(Base)).toBe(Base);
  });

  it('returns an object with no default untouched', () => {
    const named = { QualflareReporter: Base };
    expect(resolveDefaultExport(named)).toBe(named);
  });

  it('does not hang on a self-referential default', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.default = cyclic;
    expect(resolveDefaultExport(cyclic)).toBe(cyclic);
  });

  it('does not hang on a default cycle between two objects', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { default: a };
    a.default = b;
    // Bounded depth: it stops and returns something rather than looping forever.
    expect(() => resolveDefaultExport(a)).not.toThrow();
  });

  it('passes null and undefined through', () => {
    expect(resolveDefaultExport(null)).toBeNull();
    expect(resolveDefaultExport(undefined)).toBeUndefined();
  });
});
