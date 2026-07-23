// Cloudflare Pages Function: /api/correcoes
// Sugestões de correção mandadas por quem joga "Completa o Ponto" (ex: letra
// com erro de digitação, resposta que devia ter sido aceita) — ficam
// guardadas pra admin revisar depois, não aplicam nada sozinhas.
// Guardado no mesmo KV dos pontos (PONTOS_KV), prefixo "correcao:".
// Env vars: RESEND_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

async function sendEmail(env, subject, html) {
  if (!env.RESEND_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Bolhas de Luz <onboarding@resend.dev>', to: ['bolhasdeluz@gmail.com'], subject, html }),
    });
  } catch {}
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const KV = env.PONTOS_KV;
  if (!KV) return json({ error: 'KV não configurado.' }, 500);

  const url = new URL(request.url);

  try {
    // GET /api/correcoes — lista todas as sugestões pendentes
    if (request.method === 'GET') {
      const list = await KV.list({ prefix: 'correcao:' });
      const items = await Promise.all(list.keys.map(k => KV.get(k.name, { type: 'json' })));
      const correcoes = items.filter(Boolean).sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      return json(correcoes);
    }

    // POST /api/correcoes  { pontoId, pontoNome, texto }
    if (request.method === 'POST') {
      const body = await request.json();
      const texto = (body.texto || '').trim();
      if (!body.pontoId || !texto) return json({ error: 'pontoId e texto são obrigatórios' }, 400);
      const id = `correcao:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const correcao = {
        id,
        pontoId: body.pontoId,
        pontoNome: body.pontoNome || '',
        texto,
        criadoEm: Date.now(),
      };
      await KV.put(id, JSON.stringify(correcao));
      await sendEmail(env,
        `💡 Sugestão de correção: ${correcao.pontoNome || correcao.pontoId}`,
        `<h2 style="color:#c4396b">Sugestão de correção — jogo Completa o Ponto</h2>
         <p><b>Ponto:</b> ${correcao.pontoNome || correcao.pontoId}</p>
         <p><b>Sugestão:</b><br>${texto.replace(/\n/g, '<br>')}</p>`
      );
      return json(correcao);
    }

    // DELETE /api/correcoes?id=... — marca como revisada/descarta
    if (request.method === 'DELETE') {
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
