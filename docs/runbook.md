# Runbook: the hub's deployment

How the hub goes up at `https://sorobanscan.com/api/`, how it is checked, how to go back, and how
its secrets are changed. The design is
[the public launch spec](superpowers/specs/2026-11-20-public-launch-design.md) ("The deployment",
"The way back", "Only through CloudFront", "The request limit"). Everything here is done by hand,
by someone who may use the AWS profile `stellar` (account of the explorer's distribution, region
`eu-central-1`).

The pieces:

| Piece | Where | Made by |
| --- | --- | --- |
| The backend: one Lambda with a function URL, its log group, two generated secrets | the stack `SorobanscanHub-production-Backend` (`infra/`) | `pnpm infra:deploy` |
| The pages: `index.html`, `assets/`, the two OpenAPI documents | the bucket `production-soroban-explorer-api-spa`, under `api/` | `pnpm upload` |
| The routing: `/api/hub/*` to the Lambda, the rest of `/api/` to the bucket | the explorer's CloudFront distribution (`soroban-block-explorer`, `infra/envs/production.json`, setting `apiHub`) | a release of the explorer's stack `Explorer-production-Delivery` |

The secrets, all in Secrets Manager, `eu-central-1`, under `sorobanscan-hub/production/`:

| Name | Holds | Made by |
| --- | --- | --- |
| `session` | the session cookie's signing secret | the stack, generated |
| `origin-secret` | JSON `{"current": "…", "previous": "…"?}`: the header CloudFront sends | the stack, generated (`current`) |
| `discord-client-secret` | Discord's client secret, as plain text | by hand, step 1 |
| `prices-token`, `x402-token` | JSON `{"current": "…", "previous": "…"?}`: the tokens' secrets shared with the two products | already there; changed as the README's "The token to Prices" and "The token to x402" say |

No value is in git, in a build or in a log. Do not paste one into a ticket or a chat.

## Before the first deploy

The stack reserves 20 concurrent executions for the function, and AWS lets an account reserve only
what leaves at least 100 unreserved. Check the account:

```sh
AWS_PROFILE=stellar aws lambda get-account-settings --region eu-central-1 \
  --query 'AccountLimit.{Total:ConcurrentExecutions,Unreserved:UnreservedConcurrentExecutions}'
```

`Unreserved` must be 120 or more. With less, the deploy fails on the function. Raise the account's
limit with a Service Quotas request for Lambda's "Concurrent executions", or release a reservation
that is not needed; do not lower this stack's 20 to make room.

A first deploy that fails rolls the whole stack back, the two secrets it generated too: they are
kept on a delete only once they exist. Before deploying again, look that neither name is still
taken:

```sh
for s in session origin-secret; do
  AWS_PROFILE=stellar aws secretsmanager describe-secret --region eu-central-1 \
    --secret-id "sorobanscan-hub/production/$s" --query DeletedDate --output text
done
```

Both must answer `ResourceNotFoundException`. A date is a secret waiting out its recovery window,
`None` one still there: either way its name is taken and the deploy would fail with "already
exists". Such a secret was made by the failed deploy and nothing has read it, so remove it at once
with `aws secretsmanager delete-secret --force-delete-without-recovery --secret-id <name>`.

The four pull requests of the launch are merged: three in this repo (the pages, the backend's
guards, the Lambda with its stack and this runbook) and the explorer's `apiHub` setting.
Nothing is deployed before that.

## The first deployment

### 1. The Discord application and its secret

By akot, in the Discord developer portal, on the production application:

- Redirect: `https://sorobanscan.com/api/hub/auth/callback`.
- Privacy policy URL: `https://sorobanscan.com/api/privacy-policy` (the policy moved there from
  `/api/prices-api/privacy-policy`).

Put its client secret in Secrets Manager, without it landing in the shell's history:

```sh
read -rs DISCORD_CLIENT_SECRET
printf %s "$DISCORD_CLIENT_SECRET" | AWS_PROFILE=stellar aws secretsmanager create-secret \
  --region eu-central-1 --name sorobanscan-hub/production/discord-client-secret \
  --secret-string file:///dev/stdin
unset DISCORD_CLIENT_SECRET
```

The Discord application's client id is not secret: it is the `discordClientId` of the next step.

### 2. The stack

From the repo's root, on an up-to-date `main` once all three pull requests are merged (not on a
feature branch), with the Discord application's client id:

```sh
AWS_PROFILE=stellar corepack pnpm infra:diff -c discordClientId=<client id>
AWS_PROFILE=stellar corepack pnpm infra:deploy -c discordClientId=<client id>
```

Read the diff first: on a first deploy it is the function, its role, its log group, its URL and the
two generated secrets, and nothing else. Then read the outputs:

```sh
AWS_PROFILE=stellar aws cloudformation describe-stacks --region eu-central-1 \
  --stack-name SorobanscanHub-production-Backend \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
```

`FunctionUrlHost` is the function URL's host (`<id>.lambda-url.eu-central-1.on.aws`), which the
explorer's setting takes in step 4. `OriginSecretName` is `sorobanscan-hub/production/origin-secret`.

Then call the function URL itself, with no header:

```sh
curl -si https://<FunctionUrlHost>/api/hub/me
```

Expected: `400` and `{"error":"not_through_the_site"}`. The same call through the explorer's
distribution would show its error page, as it turns a `403` or `404` into its own page, so always
look at the function URL directly first. Anything but `400` here:

- `503` with `sign_in_not_configured`: the function could not read a secret. Look in its log
  group for `startup_failed` (below), fix the secret or the role, and call again; the function tries
  again by itself within 10 seconds of the last failure.
- `502`: the function failed to start or to import: look in its log group for
  `Runtime.ImportModuleError` or an init error, fix it and redeploy.
- `403`: the function URL's public permission is missing. The stack sets it; look at the function's
  "Function URL" configuration in the console before going on.

### 3. The bundle

```sh
AWS_PROFILE=stellar corepack pnpm run upload --dryrun
AWS_PROFILE=stellar corepack pnpm run upload
```

`scripts/upload-bundle.sh` builds with `VITE_PRODUCTS=prices,x402` and
`VITE_PORTAL_API_ORIGIN=https://prices-api.sorobanscan.com`, stops if `dist/index.html` is missing
or `dist` names the address `/api/x402-facilitator`, and copies `dist/` to
`s3://production-soroban-explorer-api-spa/api/` with two `aws s3 sync` calls and no `--delete`:
`assets/` with `Cache-Control: public, max-age=31536000, immutable`, the rest with
`public, max-age=0, must-revalidate`. The old Prices portal's `api/prices-api/index.html` and its
assets stay, and so do earlier builds' assets. The bundle's `prices-api/openapi.json` replaces the
old portal's file of that name, which is the same document.

Nothing serves it yet: `https://sorobanscan.com/api/assets/…` still answers `302` to `/api/`.

The explorer serves from the bundle only `/api/`, `/api/assets/*` and the addresses under six
first names: `login`, `dashboard`, `quick-start`, `docs`, `privacy-policy`, `prices-api`
(`API_HUB_PAGES` in its `infra/src/lib/cloudfront-functions/api-hub-routing.ts`). Any other first
name answers `302` to `/api/`. So a new page at a new first name (`/api/status`), or a file at the
bundle's top level (`public/robots.txt` served as `/api/robots.txt`), needs that list changed and
the explorer's `-Delivery` released before the bundle that uses it is uploaded. A page or a file
under one of the six names needs nothing there.

### 4. The explorer: the backend

In `soroban-block-explorer`, a pull request that adds to `infra/envs/production.json`:

```json
"apiHub": {
  "backendHost": "<FunctionUrlHost>",
  "originSecretName": "sorobanscan-hub/production/origin-secret",
  "originSecretRevision": "1",
  "pages": false
}
```

The pull request goes to `develop`, as every pull request there does, but a tag deploys `master`,
which takes `develop` only through a pull request of its own (`develop` → `master`). So: merge it
into `develop`, then open and merge `develop` → `master`, then release the distribution's stack,
as that repo's `docs/deployment.md` ("Releases and the CI deploy path") says: a tag
`production-YYYY.MM.DD-N-Delivery` on `origin/master` (`infra/scripts/deploy-scope.sh` shows what
a tag will do). `develop` → `master` carries whatever else `develop` holds: read its diff before
merging it, and agree with the explorer's team when it ships.

Only `/api/hub/*` changes: CloudFront sends it to the function, with the header
`X-Hub-Origin-Secret` and the viewer's address in `X-Hub-Viewer-Ip`. Every page is still the
explorer's and the old Prices portal's.

### 5. The backend, tried from AWS

By akot, in a browser, at `sorobanscan.com`, in this order:

| Address | Must show |
| --- | --- |
| `/api/hub/auth/login` | Discord's consent screen, and back to `/api/dashboard`. That address is still the old Prices portal's: it is expected |
| `/api/hub/me` | JSON with `"authenticated":true` and the account |
| `/api/hub/prices/account` | the Prices account's JSON |
| `/api/hub/x402/account` | the x402 account's JSON |

This is the first time the two products are called from AWS's addresses and not from a laptop.
Cloudflare is in front of both. If a call shows `prices_unavailable` or `x402_unavailable`, the
product's backend refused the hub's call: put it right in `soroban-infrastructure` (the shared
sign-in design's decisions 16 and 25) and try again before the next step. The same words in the
function's log group tell which product.

### 6. The explorer: the pages (the start)

A second pull request in `soroban-block-explorer`: `"pages": true` in the same setting. Merge it,
take it to `master` and release `-Delivery`, as in step 4. This is the start: from here `/api/` is
the hub's.

### 7. The checks

First with `curl`: one line per row of the spec's three tables. A status is what the line must
print; `Location` is what it must print after the status, where there is one. Run them from the
repo's root.

Pages, from the bundle (`curl -sI` prints the status line and the headers):

```sh
curl -sI https://sorobanscan.com/api | grep -i -e '^HTTP' -e '^location'  # 301, Location: /api/
curl -sI https://sorobanscan.com/api/ | head -n 1                 # 200
curl -sI https://sorobanscan.com/api/quick-start/x402 | head -n 1 # 200
curl -sI https://sorobanscan.com/api/docs/prices | head -n 1      # 200
curl -sI https://sorobanscan.com/api/docs/x402/anything | head -n 1  # 200: the page then goes to /api/docs/x402
curl -sI https://sorobanscan.com/api/dashboard/prices | head -n 1 # 200
curl -sI https://sorobanscan.com/api/login | head -n 1            # 200
curl -sI https://sorobanscan.com/api/dashboard | head -n 1        # 200: the page itself sends a visitor with no session to /api/login
curl -sI https://sorobanscan.com/api/privacy-policy | head -n 1   # 200
curl -sI https://sorobanscan.com/api/prices-api/ | grep -i -e '^HTTP' -e '^x-robots-tag'  # 200, x-robots-tag: noindex
curl -sI https://sorobanscan.com/api/prices-api/login | head -n 1 # 200: the page sends the browser to the hub's /api/login
curl -sI https://sorobanscan.com/api/docs/x402/openapi.json | head -n 1   # 200
curl -sI https://sorobanscan.com/api/prices-api/openapi.json | head -n 1  # 200
curl -sI "https://sorobanscan.com$(curl -s https://sorobanscan.com/api/ | grep -o '/api/assets/[^"]*' | head -n 1)" | grep -i -e '^HTTP' -e '^cache-control'  # 200, long cache
```

The backend, under `/api/hub/`. A `POST` must carry `Origin: https://sorobanscan.com`:

```sh
curl -sI https://sorobanscan.com/api/hub/auth/login | grep -i -e '^HTTP' -e '^location'          # 303, Location: https://discord.com/…
curl -sI https://sorobanscan.com/api/hub/auth/callback | grep -i -e '^HTTP' -e '^location'       # 303, Location: /api/login?signin=…
curl -s https://sorobanscan.com/api/hub/me                                                       # 200 {"authenticated":false}
curl -si -X POST -H 'Origin: https://sorobanscan.com' https://sorobanscan.com/api/hub/auth/logout | head -n 1   # 204
curl -si https://sorobanscan.com/api/hub/prices/account                                          # 401 {"error":"not_signed_in"}
curl -si https://sorobanscan.com/api/hub/x402/account                                            # 401 {"error":"not_signed_in"}
curl -si -X POST -H 'Origin: https://sorobanscan.com' https://sorobanscan.com/api/hub/prices/key/reveal   # 401 not_signed_in
curl -si -X POST -H 'Origin: https://sorobanscan.com' https://sorobanscan.com/api/hub/x402/key/revoke     # 401 not_signed_in
curl -si -X POST -H 'Origin: https://sorobanscan.com' https://sorobanscan.com/api/hub/auth/issue | grep -i -e '^HTTP' -e '^location'  # 303, Location: /api/login
curl -si https://sorobanscan.com/api/hub/nothing                                                 # 400 {"error":"unknown_route"}
curl -si https://<FunctionUrlHost>/api/hub/me                                                    # 400 {"error":"not_through_the_site"}
```

The limit: 30 a minute to the three that call Discord, 120 a minute to the rest (`GET me` is not
counted), each in a window of a minute from an address's first counted call. The lines above
already spent 3 of the 30 (`auth/login`, `auth/callback`, `auth/issue`) and 6 of the 120, so wait
a minute after them before the loops below, or each loop comes out short by that many. The count
is kept in each instance's memory, so these counts hold per instance: with
several instances warm, sequential calls can land on different ones. More `401`s than below, or no
`429`, means the calls were spread over instances; repeat the loop, or read it as expected.
`auth/login` only redirects to Discord and asks nothing of it, so it is safe to spend:

```sh
for i in $(seq 1 35); do curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://sorobanscan.com/api/hub/auth/login; done | sed -E 's#(https://discord.com/).*#\1…#' | sort | uniq -c
```

The three that open as pages (`auth/login`, `auth/callback`, `auth/issue`) answer an over-limit
call with `303` to `/api/login?signin=busy`, not `429`. Expected: 30 of `303 https://discord.com/…`
and then 5 of `303 https://sorobanscan.com/api/login?signin=busy`. Every other route answers `429`,
after 120 calls in a minute:

```sh
for i in $(seq 1 130); do curl -s -o /dev/null -w '%{http_code}\n' https://sorobanscan.com/api/hub/x402/account; done | sort | uniq -c
```

Expected: 120 of `401` and 10 of `429`. Your own address is then over the limit for up to a
minute: wait a minute before the browser checks below, or the dashboard's `account` calls are
answered `429`.

Old addresses:

```sh
curl -sI https://sorobanscan.com/api/x402-facilitator | grep -i -e '^HTTP' -e '^location'          # 302, Location: /api/
curl -sI https://sorobanscan.com/api/x402-facilitator/anything | grep -i -e '^HTTP' -e '^location' # 302, Location: /api/
curl -sI https://sorobanscan.com/api/openapi.json | grep -i -e '^HTTP' -e '^location'              # 301, Location: /api/prices-api/openapi.json
curl -sI https://sorobanscan.com/prices-api/foo | grep -i -e '^HTTP' -e '^location'                # 301, Location: /api/prices-api/foo
curl -sI https://sorobanscan.com/pricing-api/foo | grep -i -e '^HTTP' -e '^location'               # 301, Location: /api/prices-api/foo
curl -sI 'https://sorobanscan.com/api/nothing?x=1' | grep -i -e '^HTTP' -e '^location'             # 302, Location: /api/ (no query)
curl -sI 'https://sorobanscan.rumblefish.dev/api/login?from=prices' | grep -i -e '^HTTP' -e '^location'  # 301, Location: https://sorobanscan.com/api/login?from=prices
```

Then in a browser, at `https://sorobanscan.com/api/`: the sign-in through Discord, both tabs with
their keys, Show and Copy, a sign-out, and an old address (`/api/prices-api/login`), which must end
on the hub's sign-in page.

Known and left: a file that is not in the bundle, under one of the hub's names
(`/api/docs/x402/nope.json`), gets the explorer's `index.html` with `200`, as every missing file on
the distribution does.

## The logs

The function's log group is the one the stack made:

```sh
AWS_PROFILE=stellar aws lambda get-function-configuration --region eu-central-1 \
  --function-name "$(AWS_PROFILE=stellar aws cloudformation describe-stack-resources --region eu-central-1 \
    --stack-name SorobanscanHub-production-Backend \
    --query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" --output text)" \
  --query LoggingConfig.LogGroup --output text
```

Lines to know (a line never holds a token, a secret or a key):

- `startup_failed <reason>`: an instance could not read its settings or a secret. Until it can,
  every request is `503 sign_in_not_configured`; the next read waits 10 seconds, and it needs no
  deploy.
- `product_secret_unavailable`: a product's token secret could not be read; that product's calls
  answer `503`, the other's don't.
- `viewer_ip_missing`: a request that came through CloudFront had no usable `X-Hub-Viewer-Ip`.
  The explorer's viewer-request function (`api-hub-backend-headers`) did not deliver it, so every
  request counts as one client against the limit and the first people to arrive spend it for
  everyone. Look at the distribution's `/api/hub/*` behaviour in the explorer's stack. The line is
  logged once per instance.

## The way back

Revert step 6 (`"pages": false`), take it to `master` and release `-Delivery`, as in step 4. When
`develop` holds other changes not yet on `master`, make the revert on a branch from `origin/master`
merged into `master` (the explorer's own `release/…` branches have gone that way), and the same
revert into `develop`, so the way back carries nothing else. Once that release is deployed, the
explorer's hub, the old Prices portal on its own sign-in and the x402 page behind its password are
back, from files nobody touched. `/api/hub/*` stays on the Lambda, which nothing links to. Keys issued
through the hub are the products' own and stay.

To take the backend out of the distribution too, remove `apiHub` from `infra/envs/production.json`
and release again. The hub's stack and the bundle in the bucket can stay.

## Changing a secret

An instance reads the three secrets when it starts and keeps them until it is recycled, so after
a change the function must be made to read them again. This command makes every instance read the
secrets again, by changing the function's configuration (Lambda starts new instances for a new
configuration):

```sh
FN=$(AWS_PROFILE=stellar aws cloudformation describe-stack-resources --region eu-central-1 \
  --stack-name SorobanscanHub-production-Backend \
  --query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" --output text)
AWS_PROFILE=stellar aws lambda update-function-configuration --region eu-central-1 \
  --function-name "$FN" --description "restarted $(date -u +%Y-%m-%dT%H:%M:%SZ)"
AWS_PROFILE=stellar aws lambda wait function-updated --region eu-central-1 --function-name "$FN"
```

The next request starts a new instance: its log line `REPORT` then has an `Init Duration`. The
stack's next deploy sets the description back to nothing; that is harmless.

**The header's secret (`origin-secret`).** CloudFront's copy of `current` is read by CloudFormation
whenever it updates the explorer's distribution, for any reason; raising `originSecretRevision`
is what forces that update. The order matters: at every moment the function must accept what
CloudFront sends. So do steps 1 and 2 one right after the other, with no release of the
explorer's `-Delivery` in between: one that changes the distribution would send the new value
while the running instances still know only the old one, and every call to `/api/hub/*` would be
`400 not_through_the_site` until step 2.

1. Put the new value as `current` and the old one as `previous`:

   ```sh
   OLD=$(AWS_PROFILE=stellar aws secretsmanager get-secret-value --region eu-central-1 \
     --secret-id sorobanscan-hub/production/origin-secret --query SecretString --output text \
     | jq -r 'if has("previous") then error("finish the last rotation first") else .current end')
   NEW=$(AWS_PROFILE=stellar aws secretsmanager get-random-password --region eu-central-1 \
     --password-length 64 --exclude-punctuation --query RandomPassword --output text)
   [ -n "$OLD" ] && jq -n --arg c "$NEW" --arg p "$OLD" '{current: $c, previous: $p}' \
     | AWS_PROFILE=stellar aws secretsmanager put-secret-value --region eu-central-1 \
     --secret-id sorobanscan-hub/production/origin-secret \
     --secret-string file:///dev/stdin
   unset OLD NEW
   ```

   If `previous` is already set, the first command prints `finish the last rotation first`, `OLD`
   stays empty and nothing is put: finish that rotation (step 5) before starting another.

2. Restart the function (the command above). It accepts both values from then on.
3. In the explorer, raise `originSecretRevision` (`"1"` to `"2"`, and so on) in
   `infra/envs/production.json`, merge, and release `-Delivery`. CloudFront then sends the new
   value. Wait for the deploy to finish and the distribution to say `Deployed`.
4. Check `curl -s https://sorobanscan.com/api/hub/me` answers `200` and not `400`.
5. Remove `previous`, then restart the function. The new value is read out of the secret, never
   retyped (step 1's first command would refuse here, since `previous` is set):

   ```sh
   CUR=$(AWS_PROFILE=stellar aws secretsmanager get-secret-value --region eu-central-1 \
     --secret-id sorobanscan-hub/production/origin-secret --query SecretString --output text \
     | jq -r '.current // empty')
   [ -n "$CUR" ] && jq -n --arg c "$CUR" '{current: $c}' \
     | AWS_PROFILE=stellar aws secretsmanager put-secret-value --region eu-central-1 \
     --secret-id sorobanscan-hub/production/origin-secret \
     --secret-string file:///dev/stdin
   unset CUR
   ```

**The session's (`session`).** A new value signs every member out. Put a new one, then restart the
function:

```sh
AWS_PROFILE=stellar aws secretsmanager get-random-password --region eu-central-1 \
  --password-length 64 --exclude-punctuation --query RandomPassword --output text \
  | AWS_PROFILE=stellar aws secretsmanager put-secret-value --region eu-central-1 \
  --secret-id sorobanscan-hub/production/session --secret-string file:///dev/stdin
```

Keep `--exclude-punctuation`: the function takes the session's secret only as base64, and a value
with punctuation makes every instance answer `503 sign_in_not_configured` after the restart.

**Discord's (`discord-client-secret`).** Reset it in the Discord portal, put the new value with
`aws secretsmanager put-secret-value` (as in step 1), restart the function. Until then sign-in
fails at Discord.

**The products' token secrets (`prices-token`, `x402-token`).** The four steps in the README's
"The token to Prices" and "The token to x402". An instance keeps the value for 5 minutes, so the
steps' waits there already cover it; the function needs no restart.
