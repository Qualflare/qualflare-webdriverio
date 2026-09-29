// A flaky test that ENDS GREEN. The module-level counter survives the retry,
// which runs in the same worker.
let attempts = 0;

describe('retries', function () {
  this.retries(1);

  it('fails once, then passes', async () => {
    attempts += 1;
    await browser.url('data:text/html,<h1>retries</h1>');
    if (attempts < 2) {
      await browser.takeScreenshot();
      throw new Error('deliberate first-attempt failure');
    }
  });
});
