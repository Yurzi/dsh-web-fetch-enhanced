import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { Response } from 'undici'
import { isNonPublicIpLiteral } from './address-policy.ts'
import type { FetchResolver, ProxyRouteResolver } from './resolver.ts'
import { defaultProxyRoute, requestPinned, requestVia } from './resolver.ts'
import { classifyContentType, decoderForCharset, isSameOrigin, parseCharset, validateFetchUrl } from './policy.ts'

/** Resolved transport and response limits. */
export interface HttpFetchLimits {
  maxResponseBytes: number
  maxBodyChars: number
  timeoutMs: number
  maxRedirects: number
  userAgent: string
}

/** Anonymous HTTP(S) provider with allowlist-aware address validation. */
export class EnhancedHttpFetchProvider implements WebFetchProvider {
  constructor(
    readonly id: string,
    private readonly limits: HttpFetchLimits,
    private readonly resolveAddresses: FetchResolver,
    private readonly resolveProxy: ProxyRouteResolver = defaultProxyRoute,
  ) {}

  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
    using d = deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    return await this.followAndRead(request.url, d.signal)
  }

  private async followAndRead(initialUrl: string, signal: AbortSignal): Promise<WebFetchResult> {
    let currentUrl = validateFetchUrl(initialUrl)
    let redirectsFollowed = 0

    for (;;) {
      const request = await this.requestOnce(currentUrl, signal)
      const { response } = request
      try {
        if (isRedirectStatus(response.status)) {
          if (redirectsFollowed >= this.limits.maxRedirects) {
            await response.body?.cancel()
            throw new WebError(
              `exceeded the maximum of ${this.limits.maxRedirects} redirects`,
              'WEB_REDIRECT_BLOCKED',
            )
          }
          const location = response.headers.get('location')
          if (location === null) {
            await response.body?.cancel()
            throw new WebError(
              `redirect response (HTTP ${response.status}) without a Location header`,
              'WEB_PROVIDER_ERROR',
            )
          }
          let validatedTarget: URL
          try {
            const target = resolveRedirect(location, currentUrl)
            validatedTarget = validateFetchUrl(target.toString())
            if (!isSameOrigin(validatedTarget, currentUrl)) {
              throw new WebError(
                `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
                'WEB_REDIRECT_BLOCKED',
              )
            }
          } catch (error: unknown) {
            await response.body?.cancel()
            throw error
          }
          await response.body?.cancel()
          currentUrl = validatedTarget
          redirectsFollowed++
          continue
        }

        return await this.readBody(response, currentUrl, signal)
      } finally {
        await request.close()
      }
    }
  }

  private async requestOnce(url: URL, signal: AbortSignal) {
    const headers = {
      'user-agent': this.limits.userAgent,
      'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
    }
    try {
      const route = await this.resolveProxy(url)
      if (route.proxied && route.dispatcher && !isNonPublicIpLiteral(url.hostname)) {
        return await requestVia(route.dispatcher, url, headers, signal)
      }
      const addresses = await this.resolveAddresses(url.hostname, signal)
      return await requestPinned(url, addresses, headers, signal)
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      throw translateAbortOrNetwork(error, signal)
    }
  }

  private async readBody(response: Response, finalUrl: URL, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await response.body?.cancel()
      throw new WebError(
        `unsupported content type "${contentType ?? 'unknown'}"`,
        'WEB_UNSUPPORTED_CONTENT_TYPE',
      )
    }

    let decoder: TextDecoder
    try {
      decoder = decoderForCharset(parseCharset(contentType))
    } catch (error: unknown) {
      await response.body?.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > this.limits.maxBodyChars
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded
    const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  private async readCapped(
    response: Response,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(
          `response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`,
          'WEB_FETCH_TOO_LARGE',
        )
      }
    }

    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }

    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = this.limits.maxResponseBytes - total
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } catch (error: unknown) {
      throw translateAbortOrNetwork(error, signal)
    } finally {
      await reader.cancel().catch(() => {})
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function resolveRedirect(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch (error: unknown) {
    throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

function translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout !== undefined) {
    return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
  }
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}
