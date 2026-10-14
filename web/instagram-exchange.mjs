// Dedicated Instagram OAuth error handling. Never record authorization codes,
// access tokens, app secrets, provider URLs, or raw upstream response text.
export class InstagramExchangeError extends Error {
  constructor(stage, reason, upstreamStatus = null) {
    super("Instagram authorization could not be completed.");
    this.name = "InstagramExchangeError";
    this.stage = stage;
    this.reason = reason;
    this.upstreamStatus = Number.isInteger(upstreamStatus) ? upstreamStatus : null;
  }
}

export function classifyInstagramError(stage, status, body) {
  const nested = body?.error && typeof body.error === "object" ? body.error : {};
  const message = String(body?.error_message || body?.error_description || nested.message || body?.message || "").toLowerCase();
  let reason = "instagram_upstream_rejected";
  if (/invalid authorization code|invalid verification code|invalid code|code (is )?(invalid|expired|already|used)/.test(message)) {
    reason = "instagram_code_invalid";
  } else if (/expired|already used|code.*used|verification code/.test(message)) {
    reason = "instagram_code_expired_or_used";
  } else if (/redirect.?uri|redirect url|redirect_uri/.test(message)) {
    reason = "instagram_redirect_mismatch";
  } else if (/client.secret|invalid client|app.secret|invalid app|app id/.test(message)) {
    reason = "instagram_client_configuration";
  } else if (/rate.?limit|too many requests|throttl/.test(message) || status === 429) {
    reason = "instagram_rate_limited";
  } else if (/permission|scope|not authorized|does not have access/.test(message)) {
    reason = "instagram_permission_denied";
  }
  return new InstagramExchangeError(stage, reason, status);
}

export function publicInstagramError(error) {
  if (!(error instanceof InstagramExchangeError)) return null;
  const explanations = {
    instagram_code_invalid: "Instagram rejected the authorization code. Start a fresh Instagram login and approve again.",
    instagram_code_expired_or_used: "Instagram says the code was already used or expired. Start a fresh Instagram login.",
    instagram_redirect_mismatch: "Instagram refused the registered callback URL. The Meta Manager redirect configuration needs repair.",
    instagram_client_configuration: "Instagram rejected the application credentials. Review the Instagram App Secret configuration.",
    instagram_rate_limited: "Instagram temporarily limited token exchange. Retry later.",
    instagram_permission_denied: "Instagram did not authorize the requested account or permissions.",
    instagram_upstream_rejected: "Instagram rejected the token request. Review the categorized diagnostic for the failing stage.",
    instagram_network_error: "The broker could not contact Instagram's token service.",
    instagram_short_token_missing: "Instagram's short-lived token response was incomplete.",
  };
  const status = error.reason === "instagram_code_invalid" || error.reason === "instagram_code_expired_or_used" ? 422 : 502;
  return {
    status,
    body: {
      error: explanations[error.reason] || "Instagram authorization was unsuccessful.",
      reason: error.reason,
      stage: error.stage,
      providerHttpStatus: error.upstreamStatus,
    },
  };
}

async function requestJson(url, options, stage, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new InstagramExchangeError(stage, "instagram_network_error");
  }
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw classifyInstagramError(stage, response.status, result);
  return result;
}

export async function exchangeInstagramToken({clientId, clientSecret, code, redirectUri}, fetchImpl = fetch) {
  const short = await requestJson("https://api.instagram.com/oauth/access_token", {
    method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"authorization_code",redirect_uri:redirectUri,code}),
    signal:AbortSignal.timeout(12000),
  }, "instagram_code_exchange", fetchImpl);
  if (!short.access_token || typeof short.access_token !== "string") {
    throw new InstagramExchangeError("instagram_code_exchange", "instagram_short_token_missing");
  }
  const params = new URLSearchParams({grant_type:"ig_exchange_token",client_secret:clientSecret,access_token:short.access_token});
  return requestJson("https://graph.instagram.com/access_token?" + params.toString(), {
    signal:AbortSignal.timeout(12000),
  }, "instagram_long_token_exchange", fetchImpl);
}
