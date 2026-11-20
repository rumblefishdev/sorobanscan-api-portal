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
| The backend: the Lambda `sorobanscan-hub-production-backend` with a function URL, its log group, two generated secrets, the SSM parameter with the URL's host, two alarms | the stack `SorobanscanHub-production-Backend` (`infra/`) | `pnpm infra:deploy` |
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

The function URL's host (`<id>.lambda-url.eu-central-1.on.aws`) is not a secret, since the header
is the lock, but it is kept out of git and out of anything public all the same. Anyone who has
it can call the function directly: each such call is answered `400` before anything is read, but
it is an invocation, counted against the function's 20 instances, so a flood of them throttles
the site's own calls. The stack writes it into the SSM parameter
`/sorobanscan-hub/production/backend-host` (`eu-central-1`), where the explorer's stack reads it
when it deploys; it is in neither repo, and the stack has no output with it, so a deploy never
prints it. Never paste it into a ticket, a chat, a pull request or a screenshot. If it leaked,
see "If the function URL's host leaked".

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

The two alarms (below, "The alarms") post to stellar-x402's topic `x402-production-alarms`, which
Amazon Q Developer (Chatbot) sends to Slack's `#stellar-x402-bot`. It is in the same account and
region, and its policy is SNS's default, which lets the account's own CloudWatch alarms publish
(stellar-x402's `infra/src/lib/stacks/alarms-stack.ts` never replaces it): nothing changes there.
Its ARN is the stack's context value `alarmTopicArn`, given on the command line, so the account's
id stays out of git. Read it from stellar-x402's stack:

```sh
TOPIC=$(AWS_PROFILE=stellar aws cloudformation describe-stacks --region eu-central-1 \
  --stack-name X402-production-Alarms \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text)
echo "$TOPIC"   # arn:aws:sns:eu-central-1:<account>:x402-production-alarms
```

An error or an empty line: stellar-x402's alarms are not deployed in this account; stop and ask
there. The deploy commands below use `$TOPIC`.

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
feature branch), with the Discord application's client id and the topic's ARN (`$TOPIC`, above):

```sh
AWS_PROFILE=stellar corepack pnpm infra:diff -c discordClientId=<client id> -c alarmTopicArn="$TOPIC"
AWS_PROFILE=stellar corepack pnpm infra:deploy -c discordClientId=<client id> -c alarmTopicArn="$TOPIC"
```

Every later deploy of the stack takes the same two values; without either, the synth stops and
names it.

Read the diff first: on a first deploy it is the function, its role, its log group, its URL with
its two permissions, the SSM parameter `BackendHost`, the two alarms and the two generated
secrets, and nothing else. Then read the outputs:

```sh
AWS_PROFILE=stellar aws cloudformation describe-stacks --region eu-central-1 \
  --stack-name SorobanscanHub-production-Backend \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
```

`OriginSecretName` is `sorobanscan-hub/production/origin-secret` and `BackendHostParameterName`
`/sorobanscan-hub/production/backend-host`: the two names the explorer's setting takes in step 4.

Then call the function URL itself, with no header. The host comes from the parameter and stays in
the shell (above: never paste it anywhere):

```sh
curl -si "https://$(AWS_PROFILE=stellar aws ssm get-parameter --region eu-central-1 \
  --name /sorobanscan-hub/production/backend-host --query Parameter.Value --output text)/api/hub/me"
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

Last, see that the alarms reach Slack. Say in `#stellar-x402-bot` that a test of the hub's alarms
follows, then:

```sh
AWS_PROFILE=stellar aws cloudwatch set-alarm-state --region eu-central-1 \
  --alarm-name sorobanscan-hub-production-backend-throttles \
  --state-value ALARM --state-reason "Delivery test of the hub's alarms"
```

Expected: the alarm's message in `#stellar-x402-bot` within a minute or two. The alarm goes back
to `OK` at its next evaluation, a few minutes later, without a message. No message: the alarm's
history says whether the publish failed
(`aws cloudwatch describe-alarm-history --region eu-central-1 --alarm-name
sorobanscan-hub-production-backend-throttles --history-item-type Action`), and Chatbot's own log
group, `/aws/chatbot/x402-production-alarms` in `us-east-1`, whether Slack refused it.

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
  "backendHostParameter": "/sorobanscan-hub/production/backend-host",
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

The setting names the parameter, never the host. The explorer's stack reads the parameter's
value each time it deploys (a CloudFormation parameter of SSM type), so the hub's stack must be
deployed (step 2) before this release: without the parameter, the explorer's deploy stops before
changing anything.

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
curl -si "https://$(AWS_PROFILE=stellar aws ssm get-parameter --region eu-central-1 --name /sorobanscan-hub/production/backend-host --query Parameter.Value --output text)/api/hub/me"  # 400 {"error":"not_through_the_site"}
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

The function's log group is `/aws/lambda/sorobanscan-hub-production-backend`, kept for a month.

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

## The alarms

Two, made by the stack, each to `x402-production-alarms` and so to `#stellar-x402-bot`, with a
message when it goes to `ALARM` and none when it goes back to `OK`. Both count what happened in 5
minutes, and a 5 minutes with no data is not a fault.

**`sorobanscan-hub-production-backend-throttles`**: Lambda's `Throttles` for the function, a Sum
of 1 or more. Lambda refused calls because the function's 20 reserved instances were all busy,
or because more than 200 requests came in a second (a function URL takes 10 times its reserved
concurrency a second, [AWS](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html#urls-throttling)).
The function URL then answers `429` to everybody, the site's own calls included: for that time
nobody signs in and the dashboards show no data. First checks, in the function's "Monitor" tab
in the console over the last hour:

- `Duration` near 20 to 29 seconds, with the requests at their usual level: the instances were
  held by slow calls to Discord or a product. The log group says which (`prices_call_failed`,
  `x402_call_failed`, `prices_call_retried`, `x402_call_retried`). Not an attack; it ends when
  the product does.
- The requests (`UrlRequestCount`) far above their usual level, nearly all `4xx`
  (`Url4xxCount`): a flood. If the explorer's distribution shows the same jump in its own
  `Requests` (CloudWatch, `us-east-1`), it came through the site: the limit by address can't stop
  many addresses and doesn't count `GET me`, and AWS WAF's rate rule on the distribution is the
  answer (the public launch spec, "The request limit"), a change in the explorer agreed with its
  team. If the distribution's requests are flat, the calls go to the function URL directly: its
  host leaked, see "If the function URL's host leaked".

**`sorobanscan-hub-production-backend-url-5xx`**: the function URL's `Url5xxCount`, a Sum of 5 or
more. Answers with a `5xx`: the function's errors and timeouts, an instance that can't read its
settings (`503 sign_in_not_configured`), a product that doesn't answer (`502`
`prices_unavailable` or `x402_unavailable`, `503` `prices_busy` or `x402_busy`) or whose secret
can't be read (`503 product_not_configured`). First check, the log group's last 15 minutes:

```sh
AWS_PROFILE=stellar aws logs filter-log-events --region eu-central-1 \
  --log-group-name /aws/lambda/sorobanscan-hub-production-backend \
  --start-time $(( ($(date +%s) - 900) * 1000 )) \
  --filter-pattern '?startup_failed ?product_secret_unavailable ?prices_call_failed ?x402_call_failed ?request_failed ?"Task timed out" ?"Runtime."' \
  --query 'events[].message' --output text
```

`startup_failed` and `product_secret_unavailable` are a secret or the role ("The logs", above);
`*_call_failed` a product's backend, which Cloudflare in front of it may be refusing from AWS's
addresses (step 5); `Task timed out` or `Runtime.` the function itself, which a redeploy of the
last good `main` puts back.

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
FN=sorobanscan-hub-production-backend
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

## If the function URL's host leaked

The host alone opens nothing (each direct call is answered `400`), but every call is billed and
counted against the 20 instances, so a flood of direct calls throttles the site. Once the host is
known outside the account, give the function a new one. The new host is never written down: it
goes from the hub's stack to the explorer's through the parameter.

Why it takes two deploys. Lambda gives a function one URL per qualifier (here `$LATEST`), whose
address never changes, and creating a second one fails with `ResourceConflictException`; a URL
that is deleted can't be recovered, and the next one gets a different address
([AWS](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html),
[CreateFunctionUrlConfig](https://docs.aws.amazon.com/lambda/latest/api/API_CreateFunctionUrlConfig.html)).
Renaming the URL's construct in the stack would not do it: CloudFormation creates the new resource
before it deletes the old one
([update behaviors](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-update-behaviors.html)),
so Lambda would refuse the new URL and the deploy would roll back. So the first deploy removes
the URL, with `-c functionUrl=off`, and the second, without it, makes a new one.

**The outage.** From the end of the first deploy until CloudFront has deployed the explorer's
release, every call to `/api/hub/*` fails: nobody signs in and the dashboards show no data.
Pages are served, and sessions stay good, since their secret doesn't change. It lasts the two
deploys of the hub's stack, a few minutes each, plus the explorer's release, its workflow and
CloudFront's deployment. Prepare that release before starting: a tag on `origin/master` deploys
what `master` holds for `-Delivery`, so look at it with `infra/scripts/deploy-scope.sh` and agree
with the explorer's team, as in step 4, and have someone at hand who can approve the explorer's
production deploy.

1. Keep the old host in the shell, for the check in step 3, and remove the URL (`$TOPIC` as in
   "Before the first deploy"):

   ```sh
   OLD=$(AWS_PROFILE=stellar aws ssm get-parameter --region eu-central-1 \
     --name /sorobanscan-hub/production/backend-host --query Parameter.Value --output text)
   AWS_PROFILE=stellar corepack pnpm infra:diff -c discordClientId=<client id> -c alarmTopicArn="$TOPIC" -c functionUrl=off
   AWS_PROFILE=stellar corepack pnpm infra:deploy -c discordClientId=<client id> -c alarmTopicArn="$TOPIC" -c functionUrl=off
   ```

   The diff removes the URL, its two permissions and the parameter `BackendHost`, and nothing
   else. From here the old host is gone, and the outage has begun. Release nothing of the
   explorer's now: with no parameter its deploy stops before changing anything.

2. At once, the same deploy without `-c functionUrl=off`:

   ```sh
   AWS_PROFILE=stellar corepack pnpm infra:deploy -c discordClientId=<client id> -c alarmTopicArn="$TOPIC"
   ```

   It adds the three back: a URL with a new host, and the parameter holding it. Should it fail
   with `ResourceConflictException` (Lambda still deleting the old URL), run it again.

3. Check both hosts from the shell, without printing either:

   ```sh
   NEW=$(AWS_PROFILE=stellar aws ssm get-parameter --region eu-central-1 \
     --name /sorobanscan-hub/production/backend-host --query Parameter.Value --output text)
   [ "$NEW" != "$OLD" ] && echo "new host"
   curl -s "https://$NEW/api/hub/me"; echo   # {"error":"not_through_the_site"}
   curl -s "https://$OLD/api/hub/me"; echo   # anything but that line: Lambda's own refusal
   unset OLD NEW
   ```

4. Release the explorer's `-Delivery`: a tag `production-YYYY.MM.DD-N-Delivery` on
   `origin/master`, as in step 4, with no pull request, since its setting names the parameter and
   not the host. The deploy reads the parameter's new value: CloudFormation reads an SSM-typed
   parameter on every create and update of a stack
   ([AWS](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html)),
   and the CDK CLI never skips the deploy of a stack that has one. Wait for the distribution to
   say `Deployed`.

5. `curl -s https://sorobanscan.com/api/hub/me` answers `200`; then a sign-in in a browser. The
   outage is over.

Not chosen: a URL on an alias would let the new host exist before the old one goes, with no
outage, at the cost of a published version and an alias in the stack, for an event that should
not happen.
