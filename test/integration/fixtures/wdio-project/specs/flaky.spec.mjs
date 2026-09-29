// A module-level counter survives Mocha's retry: the retry runs in the same
// worker process, so the first attempt fails and the second passes.
let attempts = 0;

describe('Flaky', function () {
  this.retries(1);

  it('passes on the second attempt', async () => {
    attempts += 1;
    await browser.url('data:text/html,<p>flaky</p>');
    if (attempts === 1) {
      throw new Error('first attempt fails');
    }
  });
});
