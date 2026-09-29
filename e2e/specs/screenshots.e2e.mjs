describe('screenshots', () => {
  it('attaches a screenshot WebdriverIO took', async () => {
    await browser.url('data:text/html,<h1 style="color:%23d33">screenshot</h1>');
    // Picked up from the command stream; nothing Qualflare-specific is called.
    await browser.takeScreenshot();
  });
});
