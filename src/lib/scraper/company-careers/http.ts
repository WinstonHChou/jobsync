import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Readable } from "node:stream";
import { isPublicCareerIp, parseCareerSiteUrl, requiresCareerSiteAuthorization } from "@/lib/careerSiteUrl";
import { CAREER_LIMITS } from "./config";

export class CareerHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function resolveCareerAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicCareerIp(a.address))) {
    throw new Error("Careers URLs must resolve only to public network addresses");
  }
  return addresses[0];
}

// Native HTTPS with a pinned DNS result, normal TLS hostname verification, and
// no proxy/credential forwarding. Each redirect goes through the same checks.
export async function fetchCareerPage(input: string, parentSignal?: AbortSignal): Promise<{ url: string; body: string }> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(CAREER_LIMITS.requestTimeoutMs),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  let current = input;
  for (let redirect = 0; redirect <= CAREER_LIMITS.maxRedirects; redirect++) {
    signal.throwIfAborted();
    const url = parseCareerSiteUrl(current);
    if (!url) throw new Error("Enter a public HTTPS careers URL");
    if (requiresCareerSiteAuthorization(url)) throw new Error("Meta careers requires an authorized integration and is not supported by this source");
    const address = await new Promise<Awaited<ReturnType<typeof resolveCareerAddress>>>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      resolveCareerAddress(url.hostname).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted();
    const result = await new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      const req = request(url, {
        signal,
        agent: false,
        ...{ autoSelectFamily: false },
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: { accept: "text/html,application/json,application/xml;q=0.8", "accept-encoding": "identity", "user-agent": "JobSync/1.0 (company careers monitor)" },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy(); resolve({ status, location: res.headers.location, body: "" }); return;
        }
        if (status < 200 || status >= 300) {
          res.destroy(); reject(new CareerHttpError(status, status === 429 ? "rate limited" : `Careers site returned ${status}`)); return;
        }
        if (Number(res.headers["content-length"] ?? 0) > CAREER_LIMITS.maxBytes) {
          res.destroy(); reject(new Error("Careers response exceeds the size limit")); return;
        }
        let stream: Readable = res;
        const encoding = res.headers["content-encoding"];
        if (encoding === "gzip") stream = res.pipe(createGunzip());
        else if (encoding === "deflate") stream = res.pipe(createInflate());
        else if (encoding === "br") stream = res.pipe(createBrotliDecompress());
        else if (encoding && encoding !== "identity") {
          res.destroy(); reject(new Error("Unsupported careers response encoding")); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("Careers response was interrupted")));
        stream.on("error", (error) => { res.destroy(); reject(error); });
        stream.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > CAREER_LIMITS.maxBytes) {
            stream.destroy(); res.destroy(); reject(new Error("Careers response exceeds the size limit"));
          } else chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end();
    });
    if (result.status >= 200 && result.status < 300) return { url: url.href, body: result.body };
    if (!result.location || redirect === CAREER_LIMITS.maxRedirects) throw new Error("Careers redirect limit reached");
    current = new URL(result.location, url).href;
  }
  throw new Error("Careers redirect limit reached");
}
