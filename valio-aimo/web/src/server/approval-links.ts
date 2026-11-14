import QRCode from "qrcode";
import { publicBaseUrl } from "./config";

/**
 * Links and QR codes for other screens.
 *
 *   const { url, qrPayload, qrSvg } = await approvalLink(approvalId, req)
 *
 * `url` opens the sign-off screen for that order on the approver's phone. It carries no secret: approving needs
 * the approver's passkey, so the link can be shown on a big screen. `qrPayload` is the exact text to encode
 * (same as `url`); `qrSvg` is a ready-made SVG of it. The base comes from DOCK_PUBLIC_URL, else the request.
 */
export type LinkWithQr = { url: string; qrPayload: string; qrSvg: string };

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

async function withQr(url: string): Promise<LinkWithQr> {
  return { url, qrPayload: url, qrSvg: await qrSvg(url) };
}

export function approvalUrl(approvalId: string, req?: Request | Headers): string {
  return `${publicBaseUrl(req)}/approve/${encodeURIComponent(approvalId)}`;
}

export async function approvalLink(approvalId: string, req?: Request | Headers): Promise<LinkWithQr> {
  return withQr(approvalUrl(approvalId, req));
}

/** The QR code on the big screen: scanning it makes the visitor the approver of a fresh demo kitchen. */
export async function joinLink(req?: Request | Headers): Promise<LinkWithQr> {
  return withQr(`${publicBaseUrl(req)}/join`);
}
