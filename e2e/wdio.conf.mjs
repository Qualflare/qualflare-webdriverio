// The dogfood run: @qualflare/webdriverio reports on a suite of itself, loaded
// by name from built dist/, exactly as a user configures it. Three spec files
// and two workers, so every run proves that the workers agree on one runId.
//
// NO failing tests, by construction: status mapping for failures is
// test/integration/'s job, and this run is uploaded, so red has to mean a real
// regression rather than fixture noise.
export const config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.mjs'],
  maxInstances: 2,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=800,600'] },
    },
  ],
  logLevel: 'error',
  framework: 'mocha',
  mochaOpts: { timeout: 60000 },
  // No Qualflare service, on purpose: since 0.2.0 the workers derive one run
  // id from the launcher process, and this run proves it on every push (the
  // verifier asserts one runId across the three workers).
  services: [],
  reporters: [
    'spec',
    ['@qualflare/webdriverio', { resultsDir: '../e2e-results', environment: 'production' }],
  ],
};
