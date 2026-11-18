const DEFAULT_IMAGE_BASE = 'https://image.pollinations.ai/prompt';

function imageBase(): string {
  return process.env.POLLINATIONS_IMAGE_BASE_URL || DEFAULT_IMAGE_BASE;
}

function clampNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function buildUrl(prompt: string, params: URLSearchParams): string {
  const width = clampNumber(params.get('width'), 1024, 256, 2048);
  const height = clampNumber(params.get('height'), 1024, 256, 2048);
  const seed = params.get('seed') || Math.floor(Math.random() * 1_000_000).toString();
  const model = params.get('model') || 'flux';
  const nologo = params.get('nologo') ?? 'true';

  const url = new URL(`${imageBase()}/${encodeURIComponent(prompt)}`);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('seed', seed);
  url.searchParams.set('model', model);
  url.searchParams.set('nologo', nologo);

  const apiKey = process.env.POLLINATIONS_API_KEY;

  if (apiKey) {
    url.searchParams.set('token', apiKey);
  }

  return url.toString();
}

async function generate(prompt: string, params: URLSearchParams): Promise<Response> {
  if (!prompt.trim()) {
    return Response.json({ error: 'A prompt is required' }, { status: 400 });
  }

  const sourceUrl = buildUrl(prompt.trim(), params);

  const upstream = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: `Image generation failed (${upstream.status})` }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
      'X-Pollinations-Image-Url': sourceUrl,
    },
  });
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const prompt = url.searchParams.get('prompt') || '';

  return generate(prompt, url.searchParams);
}

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    width?: number;
    height?: number;
    seed?: number;
    model?: string;
  };

  const params = new URLSearchParams();

  for (const key of ['width', 'height', 'seed', 'model'] as const) {
    const value = body[key];

    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  return generate(body.prompt || '', params);
}
