# Setting up the CMS (one-time, ~5 minutes)

The admin at `/redesign/admin/` needs a GitHub OAuth App so it can log you
in and commit your edits to this repo. This part has to be done by hand —
it needs your GitHub and Vercel accounts, which I can't act on for you.

## 1. Create the GitHub OAuth App

Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**
(direct link: https://github.com/settings/applications/new) and fill in:

- **Application name:** anything, e.g. `RNR Site CMS`
- **Homepage URL:** `https://www.rifatnewajrazin.com`
- **Authorization callback URL:** `https://www.rifatnewajrazin.com/api/callback`

Click **Register application**. On the app's page, click **Generate a new
client secret**. You'll now have a **Client ID** and a **Client Secret** —
keep this tab open, you need both in the next step.

## 2. Add them to Vercel

In the Vercel dashboard, open this project → **Settings → Environment
Variables**, and add:

| Name                  | Value                        |
| ---------------------- | ----------------------------- |
| `OAUTH_CLIENT_ID`     | the Client ID from step 1     |
| `OAUTH_CLIENT_SECRET` | the Client Secret from step 1 |

Apply to **Production** (and Preview, if you want it to work on preview
deploys too). Redeploy the project once (Vercel → Deployments → ⋯ →
Redeploy) so the functions in `/api` pick up the new variables.

## 3. Log in

Visit `https://www.rifatnewajrazin.com/redesign/admin/`, click **Login with
GitHub**, authorize the app. You'll land in the CMS with a **Work** section
listing your six projects — click one open to edit its text or swap its
images, or add a new entry. Publishing commits straight to `main`, which
redeploys the live site the same way any other push does.

Your GitHub account needs write access to this repo for the login/commit
to succeed (it already does, since it's your own repo).
