# secrets steering

covers secrets, credentials, tokens, keys, and anything else that grants access. applies to code, config, commits, logs, chat, and third-party tools.

## never commit

any of the following should never end up in git history:

- `.env` files with real values
- private keys: `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, ssh keys of any kind
- cloud credentials: `*.json` service account files, `~/.aws/credentials`, `~/.config/gcloud/`, azure profiles
- api tokens, bearer tokens, oauth secrets, webhook signing secrets
- database connection strings that include a password
- `.pfx`, `.p12`, keystores
- session cookies or captured auth headers from debugging
- customer data, pii, or anything scraped from a real environment

if the `.gitignore` does not already exclude these, add them before the first relevant commit. suggested defaults:

```
.env
.env.*
!.env.example
*.pem
*.key
id_rsa
id_ed25519
*.pfx
*.p12
.aws/
.gcloud/
```

## staging discipline

- prefer `git add <specific-file>` over `git add .` or `git add -A`. wildcards catch newly-created files you did not mean to stage, including secrets.
- before every commit, run `git status` and `git diff --cached` and eyeball what is actually going in.
- if a filename or path looks suspicious (`.env.local`, `credentials.json`, `secrets.yaml`), stop and confirm.

## in code

- never hardcode a secret in source. reference it from the environment or a secret manager.
- never log a secret, even at debug level. logs get shipped, retained, and shared.
- never include a secret in an error message. errors bubble up to places you did not expect.
- redact secrets in stack traces and dumps if the language and framework allow.

## if a secret gets committed

removing the file in a follow-up commit is not enough. git history keeps the old blob and anyone who cloned or fetched still has it. treat any commit-to-a-remote of a secret as a leak.

steps, in order:

1. rotate the secret immediately (revoke, regenerate, invalidate). this is the only step that actually contains the leak.
2. remove the secret from the current tree.
3. if the commit has not been pushed anywhere, an interactive rebase or amend to remove it is fine.
4. if it has been pushed, rotation is the fix. history rewriting after the fact is optional cleanup, not a substitute.
5. tell whoever needs to know (team, security, ops).

do not skip step 1 and hope no one noticed.

## sharing and third-party tools

- do not paste config, logs, or code into pastebins, formatters, diagram renderers, or any third-party web tool without first scanning for secrets. these services often cache and index input.
- do not send secrets over chat, including this one. if the user needs to provide a secret to test something, suggest they set it as a local env var and reference it by name.
- do not upload `.env` files or credential-bearing config to shared drives, tickets, or screenshots.

## `.env.example` and onboarding

- keep a `.env.example` (or equivalent) committed to the repo with the required variable *names* and placeholder values. never real ones.
- document how a new developer should obtain the real values (password manager, cloud console, ops runbook) rather than pasting them anywhere.

## ci and deploy

- ci secrets live in the ci provider's secret store, referenced by name. never inline them into workflow files.
- deploy-time secrets come from the platform's secret manager (kubernetes secret, aws secrets manager, gcp secret manager, vault). not from committed config.
- if a secret must be templated into a config file at deploy time, the template is committed with a placeholder; the substitution happens at deploy.

## defensive checks

before committing, quickly scan for common patterns:

- `password=`, `passwd=`, `secret=`, `token=`, `api_key=`, `apikey=`
- `-----BEGIN` (private keys)
- long base64 or hex strings that look out of place
- urls containing `://user:pass@`

when in doubt, ask before committing.
