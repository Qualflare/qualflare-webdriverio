describe('Jasmine basics', () => {
  it('passes', async () => {
    await browser.url('data:text/html,<p>jasmine</p>');
  });

  // The screenshot is taken in the body, not left to wdio.conf's afterTest:
  // on WebdriverIO 8 with Jasmine, afterTest is told `passed: true` for a spec
  // whose expectation failed, so an on-failure hook never fires there.
  it('fails on purpose', async () => {
    await browser.url('data:text/html,<p>jasmine</p>');
    await browser.takeScreenshot();
    expect(1).toBe(2);
  });

  xit('is pending', () => {});
});
