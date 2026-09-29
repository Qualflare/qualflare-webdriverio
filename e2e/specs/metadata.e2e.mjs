import { qualflare } from '@qualflare/webdriverio/runtime';

describe('metadata', () => {
  it('records the author-facing metadata API', async () => {
    qualflare.label('team', 'platform');
    qualflare.link('https://github.com/Qualflare/qualflare-webdriverio', { name: 'repository' });
    qualflare.tag('dogfood');
    qualflare.priority('high');
    qualflare.description('Every qualflare.*() call, recorded against the running test.');
    qualflare.parameter('plan', 'enterprise');
    // The verifier asserts this value appears NOWHERE in the report.
    qualflare.parameter('api-key', 'qf-dogfood-secret-value', { masked: true });
    await browser.url('data:text/html,<h1>metadata</h1>');
  });

  it('nests steps', async () => {
    await qualflare.step('outer', async () => {
      await qualflare.step('inner', async () => {
        await browser.url('data:text/html,<h1>steps</h1>');
      });
    });
  });
});
