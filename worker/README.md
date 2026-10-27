# Pledge service

The component posts a pledge here. This Worker holds the OAuth secret, exchanges
the code, and posts the pledge as a comment under the pledger's own login.

A pledge is one comment on the pledge-list issue. One per person: if you already
have a comment there, the Worker sends you back to it instead of adding another.
Delete your comment to pledge again.

## Which issue

`PLEDGE_ISSUE` in `wrangler.toml` picks the target:

- `2` — testing issue, current setting
- `1` — production pledge list

`PLEDGE_REPO` is pinned in the same file. The Worker rejects pledges for any
other repo, so it cannot be used as a general-purpose comment proxy.

## OAuth app

Create an OAuth App at <https://github.com/settings/developers>:

- Homepage: `https://reform.trythursday.org`
- Callback URL: `https://reformed-vibe-coders.<subdomain>.workers.dev/auth/callback`

Use an OAuth app, not a GitHub App. An OAuth app needs no installation step, and
its token comments as the user, which is the identity the pledge needs.

## Secrets

```sh
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -hex 32 | bunx wrangler secret put STATE_SECRET
```

`STATE_SECRET` signs the pledge between the form and the callback, so it must
stay stable across deploys.

## Deploy

```sh
bunx wrangler deploy
```

Then point the site at it:

```html
<reformed-vibe-coders
  repo="trythursday/reformed-vibe-coders"
  endpoint="https://reformed-vibe-coders.<subdomain>.workers.dev/api/pledge"
></reformed-vibe-coders>
```

The endpoint answers any origin, so the component can be embedded anywhere. The
only gate that matters is the OAuth round trip: no comment is written without a
user authorising the app.
