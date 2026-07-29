/**
 * The single seam between the UI and the server.
 *
 * Every call funnels through `request()`, which means token attachment, error
 * normalisation and session expiry are handled in exactly one place.
 */

const BASE = "/api";
const TOKEN_KEY = "dsms.token";

/** Thrown for every non-2xx response, carrying the server's error envelope. */
export class ApiError extends Error {
  constructor(status, payload) {
    const body = payload && payload.error ? payload.error : {};
    super(body.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN";
    this.details = body.details || [];
  }

  /** `{ fieldName: "message" }` for painting inline form errors. */
  get fieldErrors() {
    const map = {};
    for (const detail of this.details) {
      if (detail && detail.field && !map[detail.field]) map[detail.field] = detail.message;
    }
    return map;
  }
}

// -- token storage ----------------------------------------------------------

let memoryToken = null;

export const tokenStore = {
  get() {
    if (memoryToken) return memoryToken;
    try {
      memoryToken = window.localStorage.getItem(TOKEN_KEY);
    } catch {
      // Private browsing modes can throw on localStorage access.
      memoryToken = null;
    }
    return memoryToken;
  },
  set(token) {
    memoryToken = token;
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* fall back to the in-memory copy */
    }
  },
  clear() {
    this.set(null);
  },
};

/**
 * Fired when the server rejects our token, so the auth layer can sign the user
 * out from anywhere without every call site handling 401 itself.
 */
const SESSION_EXPIRED = "dsms:session-expired";
export const onSessionExpired = (handler) => {
  window.addEventListener(SESSION_EXPIRED, handler);
  return () => window.removeEventListener(SESSION_EXPIRED, handler);
};

// -- core -------------------------------------------------------------------

async function request(method, path, { body, headers = {}, signal, auth = true } = {}) {
  const options = { method, headers: { ...headers }, signal };

  if (auth) {
    const token = tokenStore.get();
    if (token) options.headers.Authorization = `Bearer ${token}`;
  }

  if (body instanceof FormData) {
    options.body = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, { error: { code: "NETWORK", message: "Cannot reach the server" } });
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const error = new ApiError(response.status, isJson ? payload : null);

    // A rejected token means the session is over — but a 401 from the *login*
    // endpoint is just wrong credentials, and must not trigger a sign-out loop.
    const isCredentialCheck = path.startsWith("/auth/login") || path.startsWith("/auth/register");
    if (response.status === 401 && auth && !isCredentialCheck) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED, { detail: error }));
    }
    throw error;
  }

  return payload;
}

const get = (path, options) => request("GET", path, options);
const post = (path, body, options) => request("POST", path, { ...options, body });
const patch = (path, body, options) => request("PATCH", path, { ...options, body });
const put = (path, body, options) => request("PUT", path, { ...options, body });
const del = (path, options) => request("DELETE", path, options);

/** Serialise a params object into a query string, dropping empty values. */
function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * Upload with progress.
 *
 * `fetch` cannot report upload progress, so this one call uses XMLHttpRequest.
 * It resolves/rejects with the same shapes as `request()` so callers cannot
 * tell the difference.
 */
function upload(path, formData, { onProgress, method = "POST" } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE}${path}`);

    const token = tokenStore.get();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      let payload = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(payload);
        return;
      }

      const error = new ApiError(xhr.status, payload);
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED, { detail: error }));
      reject(error);
    });

    xhr.addEventListener("error", () =>
      reject(new ApiError(0, { error: { code: "NETWORK", message: "Upload failed — connection lost" } }))
    );
    xhr.addEventListener("abort", () =>
      reject(new ApiError(0, { error: { code: "ABORTED", message: "Upload cancelled" } }))
    );

    xhr.send(formData);
  });
}

/**
 * Trigger a browser download for an authenticated endpoint.
 *
 * A plain `<a href>` cannot carry the Authorization header, so the file is
 * fetched as a blob and handed to a synthetic anchor.
 */
async function downloadFile(path, filename) {
  const token = tokenStore.get();
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    throw new ApiError(response.status, isJson ? await response.json().catch(() => null) : null);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Give the browser a moment to start reading the blob before revoking it.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Shared fetch for the raw-file endpoints, with the error envelope preserved. */
async function fetchFile(path) {
  const token = tokenStore.get();
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    throw new ApiError(response.status, isJson ? await response.json().catch(() => null) : null);
  }
  return response;
}

/** Fetch a protected binary as an object URL, for inline previews. */
async function objectUrl(path) {
  return URL.createObjectURL(await (await fetchFile(path)).blob());
}

/**
 * Fetch a protected file as text.
 *
 * Needed for the public share page: there is no authenticated
 * `/preview/text` endpoint for anonymous visitors, so a text document reached
 * through a share link has to be read from the raw preview response and
 * truncated here instead.
 */
async function textOf(path, maxChars = 128 * 1024) {
  const raw = await (await fetchFile(path)).text();
  return { content: raw.slice(0, maxChars), truncated: raw.length > maxChars };
}

// -- endpoint map -----------------------------------------------------------

export const api = {
  meta: {
    health: () => get("/health", { auth: false }),
    index: () => get("/", { auth: false }),
  },

  auth: {
    register: (payload) => post("/auth/register", payload, { auth: false }),
    login: (payload) => post("/auth/login", payload, { auth: false }),
    me: () => get("/auth/me"),
    updateProfile: (payload) => patch("/auth/me", payload),
    changePassword: (payload) => post("/auth/change-password", payload),
    /** Invalidates every token for the account, this one included. */
    logoutAll: () => post("/auth/logout-all"),
    passwordStrength: (password) => post("/auth/password-strength", { password }, { auth: false }),
    directory: (search) => get(`/auth/directory${query({ search })}`),
    myActivity: (params) => get(`/auth/me/activity${query(params)}`),
  },

  documents: {
    list: (params) => get(`/documents${query(params)}`),
    tags: () => get("/documents/tags"),
    get: (id) => get(`/documents/${id}`),
    create: (formData, onProgress) => upload("/documents", formData, { onProgress }),
    update: (id, payload) => patch(`/documents/${id}`, payload),
    addVersion: (id, formData, onProgress) => upload(`/documents/${id}/versions`, formData, { onProgress }),
    star: (id) => put(`/documents/${id}/star`),
    unstar: (id) => del(`/documents/${id}/star`),
    trash: (id) => post(`/documents/${id}/trash`),
    restore: (id) => post(`/documents/${id}/restore`),
    destroy: (id) => del(`/documents/${id}?permanent=true`),
    emptyTrash: () => del("/documents/trash/empty"),
    download: (id, { version, filename } = {}) =>
      downloadFile(`/documents/${id}/download${query({ version })}`, filename),
    previewUrl: (id, { version } = {}) => objectUrl(`/documents/${id}/preview${query({ version })}`),
    textPreview: (id, { version } = {}) => get(`/documents/${id}/preview/text${query({ version })}`),
  },

  shares: {
    list: (documentId) => get(`/documents/${documentId}/shares`),
    invite: (documentId, payload) => post(`/documents/${documentId}/shares`, payload),
    createLink: (documentId, payload) => post(`/documents/${documentId}/links`, payload),
    revoke: (documentId, shareId) => del(`/documents/${documentId}/shares/${shareId}`),
  },

  publicShare: {
    view: (token, password) =>
      get(`/share/${token}`, {
        auth: false,
        headers: password ? { "x-share-password": password } : {},
      }),
    download: (token, password, filename) =>
      downloadFile(`/share/${token}/download${query({ password })}`, filename),
    previewUrl: (token, password) => objectUrl(`/share/${token}/preview${query({ password })}`),
    previewText: (token, password) => textOf(`/share/${token}/preview${query({ password })}`),
  },

  stats: {
    overview: (days) => get(`/stats/overview${query({ days })}`),
    system: () => get("/stats/system"),
    activity: (params) => get(`/stats/activity${query(params)}`),
  },

  admin: {
    users: (params) => get(`/admin/users${query(params)}`),
    updateUser: (id, payload) => patch(`/admin/users/${id}`, payload),
    storage: () => get("/admin/storage"),
    purgeOrphans: () => post("/admin/storage/purge-orphans"),
    runMaintenance: () => post("/admin/maintenance/run"),
  },
};

export { query, upload, downloadFile, objectUrl, textOf };
