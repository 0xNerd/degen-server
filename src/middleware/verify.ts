const apiKey = process.env.API_KEY;

export function verifyApiKey(req, res, next) {
    const key = req.headers['x-api-key']; // Expecting the key in the headers
    if (!key) {
      return res.status(401).json({ error: 'API key is missing' });
    }
    if (key !== apiKey) {
      return res.status(403).json({ error: 'Invalid API key' });
    }
    next();
  }
  