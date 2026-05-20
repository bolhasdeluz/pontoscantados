// Cloudflare Pages Function: /api/pontos
// CRUD de pontos cantados via KV (PONTOS_KV)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  const KV = env.PONTOS_KV;
  if (!KV) {
    return json({ error: 'KV não configurado.' }, 500);
  }

  const url = new URL(request.url);
  const method = request.method;

  try {
    // LIST — GET /api/pontos
    if (method === 'GET') {
      const list = await KV.list({ prefix: 'ponto:' });
      const items = await Promise.all(
        list.keys.map(k => KV.get(k.name, { type: 'json' }))
      );
      const pontos = items
        .filter(Boolean)
        .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      return json(pontos);
    }

    // CREATE — POST /api/pontos
    if (method === 'POST') {
      const body = await request.json();
      const id = `ponto:${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const ponto = {
        id,
        nome: body.nome || '',
        letra: body.letra || '',
        yt: body.yt || '',
        isGuia: !!body.isGuia,
        guia: body.guia || '',
        postadoPor: body.postadoPor || '',
        destaque: !!body.destaque,
        criadoEm: Date.now(),
      };
      await KV.put(id, JSON.stringify(ponto));
      return json(ponto);
    }

    // UPDATE — PUT /api/pontos  (body traz o id)
    if (method === 'PUT') {
      const body = await request.json();
      const { id, ...fields } = body;
      if (!id) return json({ error: 'id obrigatório' }, 400);
      const existing = await KV.get(id, { type: 'json' });
      if (!existing) return json({ error: 'Ponto não encontrado' }, 404);
      const updated = { ...existing, ...fields, id };
      await KV.put(id, JSON.stringify(updated));
      return json(updated);
    }

    // DELETE — DELETE /api/pontos?id=ponto:xxx
    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id obrigatório' }, 400);
      await KV.delete(id);
      return json({ ok: true });
    }

    return json({ error: 'Método não suportado' }, 405);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
