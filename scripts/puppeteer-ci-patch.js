// Patch puppeteer.launch to add --no-sandbox when running in CI.
// Loaded via NODE_OPTIONS=--require in GitHub Actions.
if (process.env.CI) {
  const puppeteer = require('puppeteer');
  const originalLaunch = puppeteer.launch.bind(puppeteer);
  puppeteer.launch = (opts = {}) => {
    const args = [...(opts.args || [])];
    if (!args.includes('--no-sandbox')) args.push('--no-sandbox');
    if (!args.includes('--disable-setuid-sandbox')) args.push('--disable-setuid-sandbox');
    return originalLaunch({ ...opts, args });
  };
}
