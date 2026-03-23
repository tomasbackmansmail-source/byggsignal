const { notifyUsers } = require('../../src/notify.js');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const result = await notifyUsers();
    res.json(result);
  } catch (err) {
    console.error('[cron/notify]', err);
    res.status(500).json({ error: err.message });
  }
};
