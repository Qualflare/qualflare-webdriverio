// Installs this package under its own name, pointing at this checkout, so the
// dogfood config can name it exactly as a user's wdio.conf does. WebdriverIO
// resolves `reporters: ['@qualflare/webdriverio']` from inside @wdio/utils, where
// a relative path or a package self-reference would not reach it.
import * as fs from 'node:fs';
import * as path from 'node:path';

const link = path.resolve('node_modules/@qualflare/webdriverio');
fs.mkdirSync(path.dirname(link), { recursive: true });
fs.rmSync(link, { recursive: true, force: true });
fs.symlinkSync('../..', link, 'dir');
