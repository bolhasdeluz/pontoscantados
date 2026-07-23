import { createProfilePayload, getUserFromRequest, isAdmin } from './_lib/auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firebase-Api-Key',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const KV = env.PONTOS_KV;
  if (!KV) return json({ error: 'KV não configurado.' }, 500);

  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Não autenticado.' }, 401);

  const profileKey = `profile:${user.id}`;

  if (request.method === 'GET') {
    const saved = await KV.get(profileKey, { type: 'json' }).catch(() => null);
    if (saved) return json({ user: { ...saved, isAdmin: isAdmin(saved.email || user.email) } });
    const profile = createProfilePayload(user);
    await KV.put(profileKey, JSON.stringify(profile));
    return json({ user: profile });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const existing = await KV.get(profileKey, { type: 'json' }).catch(() => null);
    const base = existing || createProfilePayload(user);
    const updated = {
      ...base,
      email: base.email || user.email || '',
      name: (body.name ?? base.name) || '',
      bio: (body.bio ?? base.bio) || '',
      city: (body.city ?? base.city) || '',
      isAdmin: isAdmin(base.email || user.email),
      updatedAt: Date.now(),
    };
    await KV.put(profileKey, JSON.stringify(updated));
    return json({ user: updated });
  }

  return json({ error: 'Method not allowed' }, 405);
}
