// functions/api/r2multipart.js
// Upload multipart direto pro R2 via binding nativo — usado para áudios grandes
// (acima do limite de corpo de requisição do Cloudflare: 100MB no Free/Pro, 200MB no Business).
// Em vez de mandar o arquivo inteiro de uma vez, o browser quebra em pedaços de ~8MB
// e cada pedaço vai numa requisição separada, ficando bem abaixo do limite.
// Binding: AUDIO_BUCKET → bolhasdeluz-audio (mesmo bucket do upload.js)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (!env.AUDIO_BUCKET) return json({ error: 'R2 binding (AUDIO_BUCKET) não configurado' }, 500);

  const url    = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    // ── 1. Iniciar upload multipart ──
    if (action === 'init') {
      const { filename, contentType } = await request.json();
      const ext = (filename || '').split('.').pop() || 'm4a';
      const key = `sessao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const upload = await env.AUDIO_BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || 'audio/mpeg' },
      });

      return json({ key, uploadId: upload.uploadId });
    }

    // ── 2. Enviar uma parte (≤ ~8MB cada, vindo do browser) ──
    if (action === 'part') {
      const key        = url.searchParams.get('key');
      const uploadId   = url.searchParams.get('uploadId');
      const partNumber = parseInt(url.searchParams.get('partNumber'), 10);
      if (!key || !uploadId || !partNumber) {
        return json({ error: 'Parâmetros obrigatórios: key, uploadId, partNumber' }, 400);
      }

      const upload = env.AUDIO_BUCKET.resumeMultipartUpload(key, uploadId);
      const part   = await upload.uploadPart(partNumber, request.body);

      return json({ partNumber: part.partNumber, etag: part.etag });
    }

    // ── 3. Finalizar — junta todas as partes num arquivo só no R2 ──
    if (action === 'complete') {
      const { key, uploadId, parts } = await request.json();
      if (!key || !uploadId || !parts || !parts.length) {
        return json({ error: 'Parâmetros obrigatórios: key, uploadId, parts' }, 400);
      }

      const upload = env.AUDIO_BUCKET.resumeMultipartUpload(key, uploadId);
      await upload.complete(parts);

      const publicUrl = `/api/audio/${key}`;
      return json({ url: publicUrl, key });
    }

    // ── 4. Abortar (limpeza em caso de erro no meio do upload) ──
    if (action === 'abort') {
      const { key, uploadId } = await request.json();
      if (!key || !uploadId) return json({ error: 'Parâmetros obrigatórios: key, uploadId' }, 400);
      const upload = env.AUDIO_BUCKET.resumeMultipartUpload(key, uploadId);
      await upload.abort();
      return json({ ok: true });
    }

    return json({ error: 'action inválida — use init, part, complete ou abort' }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
