// functions/api/audio/[key].js
// Serve o áudio direto do R2 pelo binding, na MESMA origem do app.
// Assim não depende do acesso público r2.dev (que pode estar desligado/limitado)
// e, por ser mesma origem, a waveform consegue ler o áudio sem barreira de CORS.
// Suporta Range requests (206) — essencial pra tocar trecho e arrastar o player.
// Binding: AUDIO_BUCKET → bolhasdeluz-audio

export async function onRequestGet(context) {
  const { env, params, request } = context;
  if (!env.AUDIO_BUCKET) return new Response('R2 (AUDIO_BUCKET) não configurado', { status: 500 });

  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  if (!key) return new Response('Chave ausente', { status: 400 });

  const rangeHeader = request.headers.get('range');
  const headers = new Headers();
  let object = null;
  let status = 200;

  try {
    if (rangeHeader) {
      const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (m) {
        const offset = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : undefined;
        const length = end !== undefined ? (end - offset + 1) : undefined;
        object = await env.AUDIO_BUCKET.get(key, { range: { offset, length } });
        if (object) {
          const total = object.size;
          const realEnd = end !== undefined ? Math.min(end, total - 1) : total - 1;
          headers.set('Content-Range', `bytes ${offset}-${realEnd}/${total}`);
          headers.set('Content-Length', String(realEnd - offset + 1));
          status = 206;
        }
      }
    }

    if (!object) {
      object = await env.AUDIO_BUCKET.get(key);
      if (object) headers.set('Content-Length', String(object.size));
    }

    if (!object) return new Response('Áudio não encontrado', { status: 404 });

    object.writeHttpMetadata(headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);

    return new Response(object.body, { status, headers });
  } catch (e) {
    return new Response('Erro ao servir áudio: ' + e.message, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response('', {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'range,content-type',
    },
  });
}
