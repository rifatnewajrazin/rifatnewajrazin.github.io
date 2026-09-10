# AGENTS.md

Rifat Newaj Razin's personal site. Served at `www.rifatnewajrazin.com` (see `CNAME`).
Static, no build step. Deploys on push: GitHub Pages from the repo, and Vercel for the
routing rules in `vercel.json`.

## Layout

- `index.html` : current live homepage at the site root.
- `redesign/` : the in-progress redesign (`index.html`, `main.js`, `styles.css`,
  plus `admin/`, `work/`, `data/`, `assets/`, `fonts/`, `uploads/`). Served at `/redesign/`.
- `redesign2/` : newer redesign scratch, assets only so far.
- `api/auth.js`, `api/callback.js` : serverless OAuth handlers (Vercel functions).
- `vercel.json` : redirects and rewrites. Notably `/honeycomb-content-planner` is
  rewritten to the external `honeycomb-content-planner.vercel.app` deployment.
- `robots.txt`, `sitemap.xml`, `serve.json` : static config.

## Rules

- No framework, no bundler. Plain HTML, CSS, and JS. Do not introduce a build
  toolchain or a package manager without being asked.
- Keep `CNAME` as `www.rifatnewajrazin.com`. Do not remove or change it.
- Do not edit `index.html` (the live root) when the work is redesign work; that
  belongs in `redesign/` or `redesign2/`. Confirm which target is intended.
- When changing routing, edit `vercel.json` only, and keep the existing
  `honeycomb-content-planner` rewrites intact unless asked.
- `api/` functions run on Vercel. Never commit client secrets or tokens; use Vercel
  environment variables and reference them by name.
- Update `sitemap.xml` when adding or removing a real public page.

## Preview locally

Any static server from the repo root, for example `npx serve` or `python3 -m http.server`.
