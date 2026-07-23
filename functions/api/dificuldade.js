// Cloudflare Pages Function: /api/dificuldade
// Votos de dificuldade (fácil/médio/difícil) por ponto, dados pelas pessoas
// jogando "Completa o Ponto" — guardado no mesmo KV dos pontos (PONTOS_KV),
// numa chave separada ("dificuldade:<pontoId>") que não colide com "ponto:...".

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const NIVEIS = ['facil', 'medio', 'dificil'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const KV = env.PONTOS_KV;
  if (!KV) return json({ error: 'KV não configurado.' }, 500);

  const url = new URL(request.url);

  try {
    // GET /api/dificuldade?pontoId=xxx
    if (request.method === 'GET') {
      const pontoId = url.searchParams.get('pontoId');
      if (!pontoId) return json({ error: 'pontoId obrigatório' }, 400);
      const votos = await KV.get('dificuldade:' + pontoId, { type: 'json' }) || { facil: 0, medio: 0, dificil: 0 };
      return json(votos);
    }

    // POST /api/dificuldade  { pontoId, nivel }
    if (request.method === 'POST') {
      const body = await request.json();
      const { pontoId, nivel } = body;
      if (!pontoId || !NIVEIS.includes(nivel)) return json({ error: 'pontoId e nivel (facil/medio/dificil) são obrigatórios' }, 400);
      const chave = 'dificuldade:' + pontoId;
      const votos = await KV.get(chave, { type: 'json' }) || { facil: 0, medio: 0, dificil: 0 };
      votos[nivel] = (votos[nivel] || 0) + 1;
      await KV.put(chave, JSON.stringify(votos));
      return json(votos);
    }

    return json({ error: 'Método não suportado' }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
