// functions/api/upload.js
// Recebe o arquivo do frontend e faz upload pro R2
// Env vars: R2_TOKEN, R2_ACCOUNT_ID (82374caea07c56b518d0bb0f1cff2d55)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não suportado' }), { status: 405, headers: CORS });
  }

  if (!env.R2_TOKEN) {
    return new Response(JSON.stringify({ error: 'R2_TOKEN não configurado' }), { status: 500, headers: CORS });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return new Response(JSON.stringify({ error: 'Arquivo não encontrado' }), { status: 400, headers: CORS });

    const ext = file.name.split('.').pop() || 'm4a';
    const key = `ponto-${Date.now()}.${ext}`;
    const accountId = '82374caea07c56b518d0bb0f1cff2d55';
    const bucket = 'bolhasdeluz-audio';

    const upload = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.R2_TOKEN}`,
          'Content-Type': file.type || 'audio/mpeg',
        },
        body: file.stream(),
      }
    );

    if (!upload.ok) {
      const err = await upload.text();
      return new Response(JSON.stringify({ error: 'Upload falhou: ' + err }), { status: 500, headers: CORS });
    }

    const url = `https://pub-6a5121068171403aa9e327fbd30cc8e6.r2.dev/${key}`;
    return new Response(JSON.stringify({ url }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
