// functions/api/transcribe.js
// Cloudflare Pages Function — proxy seguro para APIs de transcrição
// Env vars: DEEPGRAM_KEY · ASSEMBLYAI_KEY · ELEVENLABS_KEY · GOOGLE_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Provider',
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const url    = new URL(request.url);
  const prov   = url.searchParams.get('provider') || 'deepgram';
  const action = url.searchParams.get('action')   || 'transcribe';
  const jobId  = url.searchParams.get('jobId');
  const kws    = url.searchParams.get('keywords') || '';

  try {
    // AssemblyAI: polling separado (GET)
    if (prov === 'assemblyai' && action === 'poll' && jobId) {
      return await pollAssembly(jobId, env.ASSEMBLYAI_KEY);
    }
    // Drive: proxy de download com token do browser
    if (prov === 'drive') {
      const fileId = url.searchParams.get('fileId');
      const token  = request.headers.get('Authorization');
      return await driveDownload(fileId, token);
    }

    if (request.method !== 'POST') return json({ error: 'POST requerido' }, 405);

    if (prov === 'deepgram')   return await doDeepgram(request, env.DEEPGRAM_KEY, kws);
    if (prov === 'assemblyai') return await startAssembly(request, env.ASSEMBLYAI_KEY, kws);
    if (prov === 'elevenlabs') return await doElevenLabs(request, env.ELEVENLABS_KEY, kws);

    return json({ error: 'Provedor desconhecido: ' + prov }, 400);
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

// ── Deepgram Nova-2 ──────────────────────────────────────────────────────────
async function doDeepgram(request, key, kws) {
  if (!key) return json({ error: 'DEEPGRAM_KEY não configurada nas variáveis do Worker' }, 500);

  let apiUrl = 'https://api.deepgram.com/v1/listen?language=pt&punctuate=true&model=nova-2&words=true';
  if (kws) {
    const arr = kws.split(',').map(k => k.trim()).filter(Boolean);
    if (arr.length) apiUrl += '&keywords=' + arr.slice(0, 200).map(encodeURIComponent).join('&keywords=');
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Token ' + key,
      'Content-Type': request.headers.get('Content-Type') || 'audio/mpeg',
    },
    body: request.body,
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return json({ error: e.err_msg || 'Deepgram: erro ' + res.status }, res.status);
  }

  const d   = await res.json();
  const raw = d?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
  if (!raw.length) return json({ error: 'Nenhuma fala detectada no áudio.' }, 422);

  return json({ words: raw.map(w => ({ word: w.punctuated_word || w.word, start: w.start, end: w.end })) });
}

// ── AssemblyAI: iniciar job ──────────────────────────────────────────────────
async function startAssembly(request, key, kws) {
  if (!key) return json({ error: 'ASSEMBLYAI_KEY não configurada nas variáveis do Worker' }, 500);

  // 1. Upload do áudio
  const upRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/octet-stream' },
    body: request.body,
  });
  if (!upRes.ok) {
    const e = await upRes.json().catch(() => ({}));
    return json({ error: e.error || 'AssemblyAI upload: erro ' + upRes.status }, upRes.status);
  }
  const { upload_url } = await upRes.json();

  // 2. Submeter transcrição
  const arr  = kws ? kws.split(',').map(k => k.trim()).filter(Boolean) : [];
  const body = { audio_url: upload_url, language_code: 'pt', punctuate: true, format_text: true };
  if (arr.length) { body.word_boost = arr.slice(0, 1000); body.boost_param = 'high'; }

  const subRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!subRes.ok) {
    const e = await subRes.json().catch(() => ({}));
    return json({ error: e.error || 'AssemblyAI job: erro ' + subRes.status }, subRes.status);
  }

  const { id } = await subRes.json();
  return json({ jobId: id, status: 'processing' });
}

// ── AssemblyAI: polling ──────────────────────────────────────────────────────
async function pollAssembly(jobId, key) {
  if (!key) return json({ error: 'ASSEMBLYAI_KEY não configurada' }, 500);

  const res = await fetch('https://api.assemblyai.com/v2/transcript/' + jobId, {
    headers: { 'Authorization': key },
  });
  if (!res.ok) return json({ error: 'Poll erro ' + res.status }, res.status);

  const d = await res.json();
  if (d.status === 'completed') {
    const raw = d.words || [];
    if (!raw.length) return json({ error: 'Nenhuma fala detectada.' }, 422);
    return json({ status: 'completed', words: raw.map(w => ({ word: w.text, start: w.start / 1000, end: w.end / 1000 })) });
  }
  if (d.status === 'error') return json({ error: d.error || 'Erro na transcrição', status: 'error' }, 500);
  return json({ status: d.status }); // queued / processing
}

// ── ElevenLabs Scribe ────────────────────────────────────────────────────────
async function doElevenLabs(request, key, kws) {
  if (!key) return json({ error: 'ELEVENLABS_KEY não configurada nas variáveis do Worker' }, 500);

  const fd  = await request.formData();
  const newFd = new FormData();
  newFd.append('audio', fd.get('audio'));
  newFd.append('model_id', 'scribe_v1');
  newFd.append('timestamps_granularity', 'word');
  if (kws) kws.split(',').map(k => k.trim()).filter(Boolean).slice(0, 1000).forEach(w => newFd.append('keyterm', w));

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: newFd,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return json({ error: e.detail || e.message || 'ElevenLabs erro ' + res.status }, res.status);
  }

  const d   = await res.json();
  const raw = (d.words || []).filter(w => w.type === 'word');
  if (!raw.length) return json({ error: 'Nenhuma fala detectada.' }, 422);
  return json({ words: raw.map(w => ({ word: w.text, start: w.start, end: w.end })) });
}

// ── Google Drive proxy ───────────────────────────────────────────────────────
async function driveDownload(fileId, token) {
  if (!fileId) return json({ error: 'fileId obrigatório' }, 400);
  if (!token)  return json({ error: 'Authorization obrigatório' }, 401);

  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
    { headers: { Authorization: token } }
  );

  if (!res.ok) {
    if (res.status === 403) return json({ error: 'Sem permissão para este arquivo. Verifica o escopo OAuth.' }, 403);
    return json({ error: 'Drive erro ' + res.status }, res.status);
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
