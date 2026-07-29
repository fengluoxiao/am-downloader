const { _electron: playwright } = require('playwright');

(async () => {
  const app = await playwright.launch({
    args: ['.', '--no-sandbox'],
    cwd: __dirname,
    env: { ...process.env, AM_GUI_TEST: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForTimeout(2000);

  const header = await win.locator('header').innerText().catch(() => '');
  console.log('HEADER:', header.trim());

  await win.locator('input.ant-input').first().fill('周杰伦');
  await win.locator('button:has-text("搜索")').first().click();
  await win.waitForTimeout(30000);

  const cards = await win.locator('.ant-card').count();
  const bodyText = (await win.locator('body').innerText()).slice(0, 400);
  console.log('CARDS:', cards);
  console.log('BODY:', bodyText.replace(/\n+/g, ' | '));
  await win.screenshot({ path: '/tmp/am-search-e2e.png' });
  await app.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
