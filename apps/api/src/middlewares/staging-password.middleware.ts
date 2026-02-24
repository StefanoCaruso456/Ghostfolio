import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'ghostfolio_staging';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
}

@Injectable()
export class StagingPasswordMiddleware implements NestMiddleware {
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  public use(request: Request, response: Response, next: NextFunction) {
    const stagingPassword = process.env.STAGING_PASSWORD;

    if (!stagingPassword) {
      return next();
    }

    const path = request.path;

    // Serve login page
    if (path === '/staging-login' && request.method === 'GET') {
      return this.serveLoginPage(response);
    }

    // Handle login submission
    if (path === '/staging-login' && request.method === 'POST') {
      return this.handleLogin(request, response, stagingPassword);
    }

    // Allow health check endpoints without auth
    if (path === '/api/v1/import-auditor/health') {
      return next();
    }

    // Check cookie for all other routes
    const cookie = request.cookies?.[COOKIE_NAME];

    if (cookie && this.verifyCookie(cookie, stagingPassword)) {
      return next();
    }

    // Not authenticated
    const isApiRequest =
      path.startsWith('/api/') ||
      request.headers.accept?.includes('application/json');

    if (isApiRequest) {
      return response.status(401).json({
        error: 'Staging authentication required',
        loginUrl: '/staging-login'
      });
    }

    return response.redirect('/staging-login');
  }

  private serveLoginPage(
    response: Response,
    errorMessage?: string
  ): void {
    const html = this.renderLoginPage(errorMessage);
    const statusCode = errorMessage ? 401 : 200;

    response.status(statusCode).setHeader('Content-Type', 'text/html');
    response.send(html);
  }

  private renderLoginPage(errorMessage?: string): string {
    const messageHtml = errorMessage
      ? `<p class="error">${errorMessage}</p>`
      : '<p>Enter the staging password to continue.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ghostfolio Staging</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; }
    input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #333;
      border-radius: 8px;
      background: #0f3460;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 1rem;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      border: none;
      border-radius: 8px;
      background: #e94560;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #c73a52; }
    .error { color: #e94560; margin-bottom: 1rem; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Ghostfolio Staging</h1>
    ${messageHtml}
    <form method="POST" action="/staging-login">
      <input type="password" name="password" placeholder="Password" required autofocus>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
  }

  private handleLogin(
    request: Request,
    response: Response,
    stagingPassword: string
  ): void {
    const clientIp =
      (request.headers['x-forwarded-for'] as string) ||
      request.ip ||
      'unknown';

    // Rate limiting
    if (this.isRateLimited(clientIp)) {
      response.status(429).json({
        error: 'Too many login attempts. Try again in 1 minute.'
      });
      return;
    }

    this.recordAttempt(clientIp);

    const password = request.body?.password;

    if (!password || password !== stagingPassword) {
      return this.serveLoginPage(
        response,
        'Invalid password. Please try again.'
      );
    }

    // Success — set signed cookie
    const cookieValue = this.signCookie(
      Date.now().toString(),
      stagingPassword
    );

    response.cookie(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      maxAge: COOKIE_MAX_AGE_MS,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });

    response.redirect('/');
  }

  private signCookie(payload: string, secret: string): string {
    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return `${payload}.${signature}`;
  }

  private verifyCookie(cookie: string, secret: string): boolean {
    try {
      const parts = cookie.split('.');

      if (parts.length !== 2) {
        return false;
      }

      const [payload, signature] = parts;
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      if (signature.length !== expectedSignature.length) {
        return false;
      }

      const isValid = timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        return false;
      }

      // Check expiry
      const timestamp = parseInt(payload, 10);

      if (isNaN(timestamp)) {
        return false;
      }

      return Date.now() - timestamp < COOKIE_MAX_AGE_MS;
    } catch {
      return false;
    }
  }

  private isRateLimited(ip: string): boolean {
    const entry = this.rateLimits.get(ip);

    if (!entry) {
      return false;
    }

    if (Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.delete(ip);
      return false;
    }

    return entry.attempts >= MAX_ATTEMPTS;
  }

  private recordAttempt(ip: string): void {
    const entry = this.rateLimits.get(ip);

    if (!entry || Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(ip, {
        attempts: 1,
        windowStart: Date.now()
      });
    } else {
      entry.attempts++;
    }
  }
}
