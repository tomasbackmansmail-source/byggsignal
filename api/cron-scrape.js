// api/cron-scrape.js
// Scraping hanteras via GitHub Actions. Se .github/workflows/scrape.yml
module.exports = (req, res) => {
  res.status(200).json({
    message: 'Scraping hanteras via GitHub Actions. Se .github/workflows/scrape.yml',
  });
};
