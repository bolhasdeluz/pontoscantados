import { createProfilePayload, getUserFromRequest, isAdmin } from './_lib/auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const KV = env.PONTOS_KV;
  if (!KV) return json({ error: 'KV não configurado.' }, 500);

  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Não autenticado.' }, 401);

  const path = url.pathname.replace(/\/+$|^\//, '');
  if (path === 'auth' && request.method === 'GET') {
    const profile = createProfilePayload(user);
    const profileKey = `profile:${profile.id}`;
    await KV.put(profileKey, JSON.stringify(profile));
    return json({ user: profile });
  }

  if ((path === 'auth' || path === 'api/auth') && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const profileKey = `profile:${user.id}`;
    const existing = await KV.get(profileKey, { type: 'json' }).catch(() => null);
    const profile = {
      ...(existing || createProfilePayload(user)),
      ...body,
      id: user.id,
      email: user.email || existing?.email || '',
      name: user.name || existing?.name || '',
      picture: user.picture || existing?.picture || '',
      isAdmin: isAdmin(user.email || existing?.email || ''),
    };
    await KV.put(profileKey, JSON.stringify(profile));
    return json({ user: profile });
  }

  return json({ error: 'Rota não encontrada.' }, 404);
}
