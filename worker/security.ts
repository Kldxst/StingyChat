const PRIVATE_IPV4 = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
  /^0\./u,
];

export function validateCustomBaseUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/u, '');
  if (url.protocol !== 'https:') throw new Error('自定义端点必须使用 HTTPS');
  if (url.username || url.password) throw new Error('自定义端点不能在 URL 中携带凭据');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '[::1]' ||
    hostname.includes(':') ||
    PRIVATE_IPV4.some((pattern) => pattern.test(hostname))
  ) {
    throw new Error('自定义端点不能指向本地或私有网络');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url;
}

export function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export async function safeFetch(url: string | URL, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'manual' });
  } catch {
    throw new Error('无法连接上游 Provider，请检查端点和网络');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('上游端点返回了未经允许的重定向');
  }
  return response;
}
