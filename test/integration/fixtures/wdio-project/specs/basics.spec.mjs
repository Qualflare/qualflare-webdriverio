import { qualflare } from '@qualflare/webdriverio/runtime';

describe('Basics', () => {
  it('passes with metadata', async () => {
    qualflare.label('owner', 'fixtures');
    qualflare.parameter('password', 'hunter2', { masked: true });
    await qualflare.step('open the page', async () => {
      await browser.url('data:text/html,<h1 id="t">Hello</h1>');
    });
    await expect($('#t')).toHaveText('Hello');
  });

  it('fails on purpose', async () => {
    await browser.url('data:text/html,<h1 id="t">Hello</h1>');
    await expect($('#t')).toHaveText('Goodbye', { wait: 100 });
  });

  it.skip('is skipped', () => {});

  describe('nested', () => {
    it('keeps its describe chain', async () => {
      await browser.url('data:text/html,<p>nested</p>');
    });
  });
});
