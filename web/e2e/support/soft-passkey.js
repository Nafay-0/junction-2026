/*
 * A software passkey for browsers Playwright cannot give a virtual authenticator (WebKit, Firefox).
 * Injected with context.addInitScript before any page script runs. It replaces navigator.credentials.create/get
 * with a real ES256 authenticator built on WebCrypto: "none" attestation, user verified, a signature counter, and
 * a discoverable credential kept in this origin's localStorage. The server verifies it exactly as it verifies a
 * phone (origin, RP id hash, challenge, signature); only the operating system's passkey sheet is missing.
 *
 * Test hooks: window.__softPasskey.mode = "ok" | "cancel" (next prompt throws NotAllowedError, like a dismissed
 * Face ID sheet); window.__softPasskey.count(); window.__softPasskey.clear().
 */
(() => {
  if (window.__softPasskey) return;
  const KEY = "__soft_passkeys_v1";
  const enc = new TextEncoder();
  const u8 = (b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  const b64u = (bytes) => {
    let s = "";
    for (const c of bytes) s += String.fromCharCode(c);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (out.set(p, o), (o += p.length));
    return out;
  };
  const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  };
  const save = (list) => localStorage.setItem(KEY, JSON.stringify(list));

  // Minimal CBOR for the shapes WebAuthn needs: small ints, byte and text strings, maps.
  const head = (major, n) => {
    if (n < 24) return new Uint8Array([(major << 5) | n]);
    if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
    return new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
  };
  const cbor = (v) => {
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") return concat(head(3, enc.encode(v).length), enc.encode(v));
    if (v instanceof Uint8Array) return concat(head(2, v.length), v);
    if (v instanceof Map) return concat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
    throw new Error("soft passkey: cannot encode " + typeof v);
  };

  // ECDSA signatures from WebCrypto are r||s; WebAuthn wants DER.
  const der = (sig) => {
    const int = (b) => {
      let i = 0;
      while (i < b.length - 1 && b[i] === 0) i++;
      b = b.slice(i);
      return b[0] & 0x80 ? concat(new Uint8Array([0]), b) : b;
    };
    const r = int(sig.slice(0, 32));
    const s = int(sig.slice(32));
    return concat(new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
  };

  const notAllowed = () => new DOMException("The operation either timed out or was not allowed (soft passkey).", "NotAllowedError");
  const state = {
    mode: "ok",
    count: () => load().length,
    clear: () => save([]),
    rpIds: () => load().map((c) => c.rpId),
  };
  window.__softPasskey = state;

  async function create(options) {
    const pk = options.publicKey;
    if (state.mode === "cancel") throw notAllowed();
    const rpId = pk.rp?.id || location.hostname;
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
    const spki = await crypto.subtle.exportKey("spki", keys.publicKey);
    const credId = crypto.getRandomValues(new Uint8Array(16));
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33, 65)]]));
    const authData = concat(
      await sha256(enc.encode(rpId)),
      new Uint8Array([0x45, 0, 0, 0, 0]), // UP | UV | AT, counter 0
      new Uint8Array(16), // AAGUID
      new Uint8Array([0, credId.length]),
      credId,
      cose,
    );
    const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: b64u(u8(pk.challenge)), origin: location.origin, crossOrigin: false }));
    const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    const list = load();
    list.push({ id: b64u(credId), rpId, jwk, userHandle: b64u(u8(pk.user.id)), counter: 0 });
    save(list);
    return {
      id: b64u(credId),
      rawId: credId.buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: clientDataJSON.buffer,
        attestationObject: attestationObject.buffer,
        getTransports: () => ["internal"],
        getPublicKeyAlgorithm: () => -7,
        getPublicKey: () => spki,
        getAuthenticatorData: () => authData.buffer,
      },
    };
  }

  async function get(options) {
    const pk = options.publicKey;
    if (state.mode === "cancel") throw notAllowed();
    const rpId = pk.rpId || location.hostname;
    const allowed = (pk.allowCredentials || []).map((c) => b64u(u8(c.id)));
    const list = load();
    const cred = list.find((c) => c.rpId === rpId && (!allowed.length || allowed.includes(c.id)));
    if (!cred) {
      // A real phone shows "no passkeys for this site" and the person cancels; the page sees NotAllowedError.
      await new Promise((r) => setTimeout(r, 300));
      throw notAllowed();
    }
    cred.counter += 1;
    save(list);
    const key = await crypto.subtle.importKey("jwk", cred.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const c = cred.counter;
    const authData = concat(await sha256(enc.encode(rpId)), new Uint8Array([0x05, (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]));
    const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: b64u(u8(pk.challenge)), origin: location.origin, crossOrigin: false }));
    const signed = concat(authData, await sha256(clientDataJSON));
    const signature = der(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signed)));
    const rawId = fromB64u(cred.id);
    return {
      id: cred.id,
      rawId: rawId.buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: clientDataJSON.buffer,
        authenticatorData: authData.buffer,
        signature: signature.buffer,
        userHandle: fromB64u(cred.userHandle).buffer,
      },
    };
  }

  // Patch the prototype as well as the instance: WebKit can hand the page a different container object than the
  // one an init script sees, so an own-property patch alone is lost there.
  if (window.CredentialsContainer) {
    Object.defineProperty(CredentialsContainer.prototype, "create", { value: create, configurable: true, writable: true });
    Object.defineProperty(CredentialsContainer.prototype, "get", { value: get, configurable: true, writable: true });
  }
  const container = navigator.credentials || {};
  Object.defineProperty(container, "create", { value: create, configurable: true });
  Object.defineProperty(container, "get", { value: get, configurable: true });
  if (!navigator.credentials) Object.defineProperty(navigator, "credentials", { value: container, configurable: true });
  const PKC = window.PublicKeyCredential || function PublicKeyCredential() {};
  PKC.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  PKC.isConditionalMediationAvailable = async () => false;
  window.PublicKeyCredential = PKC;
})();
