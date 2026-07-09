interface UploadObjectOptions {
  contentType?: string;
}

interface UploadObjectResult {
  url: string;
  key: string;
  provider: 'r2' | 'vercel-blob';
}

type CloudflareEnvLike = Record<string, unknown> & {
  PODSUM_BUCKET?: {
    put: (key: string, value: BodyInit | ArrayBuffer, options?: unknown) => Promise<unknown>;
    get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
    delete: (key: string) => Promise<void>;
  };
  NEXTAUTH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  R2_PUBLIC_BASE_URL?: string;
  STORAGE_PROVIDER?: string;
};

function cleanUploadKey(input: string): string {
  return input
    .split('/')
    .map((segment) =>
      segment
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/\.{2,}/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, ''),
    )
    .filter(Boolean)
    .join('/')
    .slice(0, 900);
}

function cleanStoredKey(input: string): string {
  return input
    .split('/')
    .map((segment) => segment.trim().replace(/[^a-zA-Z0-9._-]+/g, '_'))
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/')
    .slice(0, 900);
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function appBaseUrl(env?: CloudflareEnvLike): string {
  return (env?.NEXTAUTH_URL || env?.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://podsum.cc')
    .replace(/\/+$/, '');
}

async function getCloudflareEnv(): Promise<CloudflareEnvLike | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    return context.env as CloudflareEnvLike;
  } catch {
    return null;
  }
}

async function toUploadBody(value: File | Blob | Buffer | Uint8Array | ArrayBuffer | string): Promise<BodyInit | ArrayBuffer> {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  if ('arrayBuffer' in value && typeof value.arrayBuffer === 'function') {
    return value.arrayBuffer();
  }
  return value as BodyInit;
}

function objectUrlForKey(key: string, env?: CloudflareEnvLike): string {
  const publicBase = (env?.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (publicBase) {
    return `${publicBase}/${encodeKeyPath(key)}`;
  }
  return `${appBaseUrl(env)}/api/files/${encodeKeyPath(key)}`;
}

export async function isObjectStorageConfigured(): Promise<boolean> {
  const env = await getCloudflareEnv();
  return Boolean(env?.PODSUM_BUCKET || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function uploadObject(
  key: string,
  value: File | Blob | Buffer | Uint8Array | ArrayBuffer | string,
  options: UploadObjectOptions = {},
): Promise<UploadObjectResult> {
  const safeKey = cleanUploadKey(key) || `upload-${Date.now().toString(36)}`;
  const env = await getCloudflareEnv();

  if (env?.PODSUM_BUCKET) {
    await env.PODSUM_BUCKET.put(safeKey, await toUploadBody(value), {
      httpMetadata: {
        contentType: options.contentType || (typeof value === 'object' && 'type' in value ? String(value.type || '') : undefined),
      },
    });
    const storedObject = await env.PODSUM_BUCKET.get(safeKey);
    if (!storedObject) {
      throw new Error(`Object storage write verification failed for key: ${safeKey}`);
    }
    return {
      key: safeKey,
      provider: 'r2',
      url: objectUrlForKey(safeKey, env),
    };
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(safeKey, value as Parameters<typeof put>[1], {
      access: 'public',
      contentType: options.contentType,
    });
    return {
      key: safeKey,
      provider: 'vercel-blob',
      url: blob.url,
    };
  }

  throw new Error('Object storage is not configured. Configure PODSUM_BUCKET on Cloudflare or BLOB_READ_WRITE_TOKEN locally.');
}

function keyFromObjectUrl(url: string, env?: CloudflareEnvLike): string | null {
  const apiMarker = '/api/files/';
  const apiIndex = url.indexOf(apiMarker);
  if (apiIndex >= 0) {
    return decodeURIComponent(url.slice(apiIndex + apiMarker.length));
  }

  const publicBase = (env?.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (publicBase && url.startsWith(`${publicBase}/`)) {
    return decodeURIComponent(url.slice(publicBase.length + 1));
  }

  return null;
}

export async function deleteObject(urlOrKey: string): Promise<void> {
  if (!urlOrKey || urlOrKey === '#mock-blob-url') {
    return;
  }

  const env = await getCloudflareEnv();
  const parsedR2Key = keyFromObjectUrl(urlOrKey, env || undefined);
  const isHttpUrl = /^https?:\/\//.test(urlOrKey);
  const key = parsedR2Key ? cleanStoredKey(parsedR2Key) : (isHttpUrl ? null : cleanUploadKey(urlOrKey));
  if (env?.PODSUM_BUCKET && key) {
    await env.PODSUM_BUCKET.delete(key);
    return;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN && isHttpUrl) {
    const { del } = await import('@vercel/blob');
    await del(urlOrKey);
  }
}

export async function getObject(key: string): Promise<Response> {
  const env = await getCloudflareEnv();
  const safeKey = cleanStoredKey(key);
  if (!env?.PODSUM_BUCKET || !safeKey) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.PODSUM_BUCKET.get(safeKey);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function getObjectText(urlOrKey: string): Promise<string> {
  const env = await getCloudflareEnv();
  const parsedR2Key = keyFromObjectUrl(urlOrKey, env || undefined);
  const isHttpUrl = /^https?:\/\//.test(urlOrKey);
  const key = parsedR2Key ? cleanStoredKey(parsedR2Key) : (isHttpUrl ? null : cleanStoredKey(urlOrKey));

  if (env?.PODSUM_BUCKET && key) {
    const object = await env.PODSUM_BUCKET.get(key);
    if (!object) {
      throw new Error('File not found in object storage.');
    }
    return await new Response(object.body).text();
  }

  if (!isHttpUrl) {
    throw new Error('Object storage is not configured for this key.');
  }

  const response = await fetch(urlOrKey);
  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText || `HTTP ${response.status}`}`);
  }
  return await response.text();
}
