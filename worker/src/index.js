const GITHUB = "https://github.com";
const API = "https://api.github.com";
const BUDGETS = [10_000_000, 100_000_000, 500_000_000, 1_000_000_000];

const encoder = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const unb64url = (value) =>
  atob(value.replaceAll("-", "+").replaceAll("_", "/"));

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return b64url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))),
  );
}

async function seal(data, secret) {
  const payload = b64url(encoder.encode(JSON.stringify(data)));

  return `${payload}.${await sign(payload, secret)}`;
}

async function unseal(token, secret) {
  const [payload, signature] = String(token ?? "").split(".");

  if (!payload || !signature) throw new Error("Malformed state.");
  if ((await sign(payload, secret)) !== signature) {
    throw new Error("State signature does not match.");
  }

  const data = JSON.parse(unb64url(payload));

  if (!data.exp || data.exp < Date.now()) throw new Error("That pledge expired.");

  return data;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const text = (body, status = 200) => new Response(body, { status });

function validate(pledge) {
  const { repo, tokens, things, website } = pledge ?? {};

  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { error: "repo must be owner/name." };
  }

  const budget = Number(tokens);

  if (
    !Number.isInteger(budget) ||
    budget <= 0 ||
    budget > 1e12 ||
    (!BUDGETS.includes(budget) && budget < 1_000_000_000)
  ) {
    return { error: "tokens must be a preset, or at least 1B." };
  }

  if (things != null && (typeof things !== "string" || things.length > 4000)) {
    return { error: "things must be text under 4000 characters." };
  }

  if (website != null) {
    let parsed;
    try {
      parsed = new URL(website);
    } catch {
      return { error: "website must be a link." };
    }

    if (!/^https?:$/.test(parsed.protocol) || website.length > 500) {
      return { error: "website must be an http(s) link." };
    }
  }

  return {
    pledged: {
      repo,
      tokens: budget,
      things: things?.trim() || null,
      website: website?.trim() || null,
    },
  };
}

const formatBudget = (tokens) => {
  if (tokens % 1_000_000 === 0) {
    const amount =
      tokens >= 1_000_000_000
        ? `${tokens / 1_000_000_000}B`
        : `${tokens / 1_000_000}M`;

    return `${amount} (${tokens.toLocaleString("en-US")} tokens)`;
  }

  return `${tokens.toLocaleString("en-US")} tokens`;
};

function issueBody(pledge) {
  const parts = [
    "### Monthly Token Pledge",
    "",
    `<span class="pledge-token-count" data-tokens="${pledge.tokens}">${formatBudget(pledge.tokens)}</span>`,
  ];

  if (pledge.things) {
    parts.push("", "### Things I would like to build", "", pledge.things);
  }

  if (pledge.website) {
    parts.push("", "### Website, LinkedIn, or Twitter", "", pledge.website);
  }

  return parts.join("\n");
}

async function github(path, token, init = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "reformed-vibe-coders",
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function existingPledge(repo, issue, token, login) {
  for (let page = 1; page <= 10; page++) {
    const response = await github(
      `/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`,
      token,
    );

    if (!response.ok) throw new Error("Could not read the pledge list.");

    const comments = await response.json();
    const mine = comments.find(
      (comment) => comment.user?.login?.toLowerCase() === login.toLowerCase(),
    );

    if (mine) return mine.html_url;
    if (comments.length < 100) break;
  }

  return null;
}

async function pledgeComment(pledge, token, login, env) {
  const repo = env.PLEDGE_REPO ?? "trythursday/reformed-vibe-coders";
  const issue = Number(env.PLEDGE_ISSUE ?? 1);

  const existing = await existingPledge(repo, issue, token, login);
  if (existing) return existing;

  const response = await github(`/repos/${repo}/issues/${issue}/comments`, token, {
    method: "POST",
    body: JSON.stringify({ body: issueBody(pledge) }),
  });

  const comment = await response.json().catch(() => null);

  if (!response.ok || !comment?.html_url) {
    throw new Error(comment?.message ?? "GitHub rejected the comment.");
  }

  return comment.html_url;
}

async function exchangeCode(request, env) {
  const response = await fetch(`${GITHUB}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: new URL(request.url).searchParams.get("code"),
      redirect_uri: `${new URL(request.url).origin}/auth/callback`,
    }),
  });

  const reply = await response.json().catch(() => null);

  if (!reply?.access_token) {
    throw new Error(reply?.error_description ?? "GitHub did not grant a token.");
  }

  return reply.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (url.pathname === "/api/pledge" && request.method === "POST") {
        const { pledged, error } = validate(await request.json().catch(() => null));

        if (error) return json({ error }, 400, CORS);

        const repo = env.PLEDGE_REPO ?? "trythursday/reformed-vibe-coders";

        if (pledged.repo !== repo) {
          return json({ error: `repo must be ${repo}.` }, 400, CORS);
        }

        const state = await seal(
          { ...pledged, exp: Date.now() + 10 * 60 * 1000 },
          env.STATE_SECRET,
        );

        const authorize = new URL(`${GITHUB}/login/oauth/authorize`);
        authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        authorize.searchParams.set("scope", "public_repo");
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);

        return json({ redirect: authorize.toString() }, 200, CORS);
      }

      if (url.pathname === "/auth/callback") {
        const pledge = await unseal(url.searchParams.get("state"), env.STATE_SECRET);
        const token = await exchangeCode(request, env);

        const user = await github("/user", token).then((body) => body.json());
        const commentUrl = await pledgeComment(pledge, token, user.login, env);

        return Response.redirect(commentUrl, 303);
      }

      return text("reformed-vibe-coders pledge service", 200);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Something went wrong." },
        400,
        CORS,
      );
    }
  },
};
