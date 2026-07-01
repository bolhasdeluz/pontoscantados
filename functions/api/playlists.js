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

  const profile = createProfilePayload(user);
  const profileKey = `profile:${profile.id}`;
  const savedProfile = await KV.get(profileKey, { type: 'json' }).catch(() => null);
  const activeProfile = savedProfile || profile;

  const isAdminUser = isAdmin(activeProfile.email || user.email || '');

  if (request.method === 'GET') {
    const list = await KV.list({ prefix: 'playlist:' });
    const items = await Promise.all(list.keys.map(k => KV.get(k.name, { type: 'json' })));
    const playlists = items.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const visible = playlists.filter(p => isAdminUser || p.ownerId === activeProfile.id || p.visibility === 'public');
    return json(visible);
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = `playlist:${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const playlist = {
      id,
      name: body.name || 'Nova playlist',
      description: body.description || '',
      items: Array.isArray(body.items) ? body.items : [],
      ownerId: activeProfile.id,
      ownerEmail: activeProfile.email || user.email || '',
      visibility: body.visibility || 'private',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await KV.put(id, JSON.stringify(playlist));
    return json(playlist);
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const id = body.id;
    if (!id) return json({ error: 'id obrigatório' }, 400);
    const existing = await KV.get(id, { type: 'json' }).catch(() => null);
    if (!existing) return json({ error: 'Playlist não encontrada' }, 404);
    if (!isAdminUser && existing.ownerId !== activeProfile.id) return json({ error: 'Sem permissão' }, 403);
    const updated = { ...existing, ...body, id, updatedAt: Date.now() };
    await KV.put(id, JSON.stringify(updated));
    return json(updated);
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id obrigatório' }, 400);
    const existing = await KV.get(id, { type: 'json' }).catch(() => null);
    if (!existing) return json({ error: 'Playlist não encontrada' }, 404);
    if (!isAdminUser && existing.ownerId !== activeProfile.id) return json({ error: 'Sem permissão' }, 403);
    await KV.delete(id);
    return json({ ok: true });
  }

  return json({ error: 'Método não suportado' }, 405);
}
