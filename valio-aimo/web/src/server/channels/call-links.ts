import { qrSvg, type LinkWithQr } from "../approval-links";
import { publicBaseUrl } from "../config";

/**
 * The call QR code, like approvalLink:
 *
 *   const { url, qrPayload, qrSvg } = await callLink(req)            a visitor's own kitchen (joins first if needed)
 *   const { url, qrSvg } = await callLink(req, { kitchen: "kaari" })  a demo kitchen, for the console preview
 *
 * Scanning it opens /call on the phone: a fresh visitor joins with one passkey tap, then is in the call with
 * their own kitchen's agent, and that kitchen's sign-offs come back to the same phone. The URL carries no secret.
 */
export function callUrl(req?: Request | Headers, opts: { kitchen?: "kaari" | "laakso" } = {}): string {
  return `${publicBaseUrl(req)}/call${opts.kitchen ? `?k=${opts.kitchen}` : ""}`;
}

export async function callLink(req?: Request | Headers, opts: { kitchen?: "kaari" | "laakso" } = {}): Promise<LinkWithQr> {
  const url = callUrl(req, opts);
  return { url, qrPayload: url, qrSvg: await qrSvg(url) };
}
