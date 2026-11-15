import { getCache } from '@vercel/functions';

const ttl = 180;
const validKey = /^[a-f0-9]{64}$/;
const validPayload = /^[A-Za-z0-9_-]{50,36000}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).end();
  }
  const { room, slot } = req.query;
  if (typeof room !== 'string' || !validKey.test(room) || !['offer', 'answer'].includes(slot)) {
    return res.status(400).end();
  }
  const cache = getCache({ namespace: 'freshy-dms-camera-v2' });
  const key = room + ':' + slot;
  try {
    if (req.method === 'GET') {
      const payload = await cache.get(key);
      return payload ? res.status(200).json({ payload }) : res.status(404).end();
    }
    if (req.method === 'DELETE') {
      await cache.delete(key);
      return res.status(204).end();
    }
    if (typeof req.body?.payload !== 'string' || !validPayload.test(req.body.payload)) {
      return res.status(400).end();
    }
    await cache.set(key, req.body.payload, { ttl });
    return res.status(204).end();
  } catch {
    return res.status(503).end();
  }
}
