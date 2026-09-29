// The integration fixture: a real WebdriverIO run, loading @qualflare/webdriverio
// BY NAME in both string forms -- the reporter as the default export, the
// service through its ./service subpath -- so the published exports map is what
// is under test, not a relative import.
const framework = process.env.FIXTURE_FRAMEWORK ?? 'mocha';

export const config = {
  runner: 'local',
  specs: [framework === 'jasmine' ? './jasmine/**/*.spec.mjs' : './specs/**/*.spec.mjs'],
  // Two workers at once: the point is that several processes agree on a runId.
  maxInstances: 2,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=800,600'] },
    },
  ],
  logLevel: 'error',
  framework,
  mochaOpts: { timeout: 60000 },
  jasmineOpts: { defaultTimeoutInterval: 60000 },
  services: [['@qualflare/webdriverio/service', { resultsDir: process.env.QUALFLARE_RESULTS_DIR }]],
  reporters: [['@qualflare/webdriverio', { resultsDir: process.env.QUALFLARE_RESULTS_DIR, environment: 'fixture' }]],
  // The idiomatic screenshot-on-failure hook, which runs after the verdict.
  afterTest: async function (_test, _context, { passed }) {
    if (!passed) {
      await browser.takeScreenshot();
    }
  },
};
