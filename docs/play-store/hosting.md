# Hosting the public pages (privacy, terms, account deletion)

Google Play needs two public web addresses: a **privacy policy** URL (App content → Privacy
policy) and an **account deletion** URL (Data safety → Data deletion). The pages are in
`docs/site/` and **GitHub Pages** serves them at `https://mitovoid-ai.github.io/lately/`
(`.github/workflows/pages.yml` deploys after every test-APK release and whenever the pages
change). Vercel (project `lately-docs`, `https://latelysave.vercel.app`) serves the same folder:
its root directory is `docs/`, and `docs/vercel.json` publishes only `docs/site/` (without it the
whole `docs/` folder went public and `/` was a 404). Vercel deploys on pushes, not on releases, so
its download button uses GitHub's always-latest link and shows no build number.
On GitHub's free plan Pages only works while the repository is **public**: if it goes
private, upload `docs/site/` to **Netlify** or **Cloudflare Pages** instead (both free, below).

## What is in `docs/site/`

| File | What it is |
|---|---|
| `index.html` | The product landing page: what Lately does, real screenshots in phone frames, sample cards, the test-APK download button (newest release), links to the three pages below |
| `landing.css`, `assets/` | The landing page's styles, screenshots (`assets/shots`, from the store capture), the demo account's sample photos (`assets/saves`), the app icon and the app's fonts (`assets/fonts`, SIL OFL). Made once by hand; the script does not rebuild them |
| `privacy.html` | The privacy policy, from `frontend/legal/privacy.md` (the same text the app shows) |
| `terms.html` | The terms of service, from `frontend/legal/terms.md` |
| `delete-account.html` | How to delete the account in the app or by email, what is deleted and kept, and the Google Play subscription step |
| `404.html` | "Page not found" |
| `style.css` | Light and dark colours (follows the phone or computer setting), system fonts |
| `_headers` | Security headers that Netlify and Cloudflare Pages apply; other hosts ignore it |

Plain HTML and CSS: no build step, no server, no scripts, no web fonts, no analytics. The
pages are made by `frontend/scripts/build-public-site.js`, which also runs every time
`node scripts/build-legal.js` runs, and in the Pages workflow before each deploy (that run also
fills in the newest release for the download button). Never edit the HTML by hand: edit the
markdown or the script, rebuild, push.

## Before the first upload: two values

The pages contain two placeholders, `[SUPPORT EMAIL]` and `[DAYS]` (how many days an emailed
deletion request may take; 30 is common). For GitHub Pages, set them as repository variables
`LATELY_SUPPORT_EMAIL` and `LATELY_DELETION_DAYS` (Settings → Secrets and variables → Actions →
Variables) and re-run the `pages` workflow. For the files in the repo and other hosts, set them once, in
`frontend/scripts/build-public-site.js` lines 23-24, by replacing the text in quotes:

```js
  supportEmail: process.env.LATELY_SUPPORT_EMAIL || "help@yourdomain.com",
  deletionDays: process.env.LATELY_DELETION_DAYS || "30",
```

Then rebuild from the `frontend` folder. `--strict` stops with an error if a placeholder is
still there:

```bash
node scripts/build-public-site.js --strict
```

The email should be the same support email as on the Play listing (`listing.md`). Whatever
number of days you write is a promise to users; meet it.

## Elsewhere, option A: Netlify

### Drag and drop (no tools to install)

1. Sign up or log in at [app.netlify.com](https://app.netlify.com) **first**. A deploy made
   without an account is temporary and is removed unless claimed within an hour
   ([Netlify: create deploys](https://docs.netlify.com/deploy/create-deploys/)).
2. Open [app.netlify.com/drop](https://app.netlify.com/drop) and drag the whole
   `docs/site` folder onto the page.
3. Netlify publishes it at an address like `https://<random-name>.netlify.app`. You can rename
   the project in its settings to get a nicer `netlify.app` address.

To update later: open the project's **Deploys** page and drag the rebuilt `docs/site`
folder into the drop zone at the bottom.

### Command line (optional)

From the `frontend` folder (Node is already installed for the app):

```bash
npx -p netlify-cli netlify login
npx -p netlify-cli netlify deploy --dir ../docs/site --prod
```

(`npx -p netlify-cli netlify` runs the Netlify CLI without installing it globally; with a
global install, `npm install -g netlify-cli`, the commands are just `netlify login` and
`netlify deploy ...`.)

The first `deploy` asks whether to create a new project or link an existing one. `--dir` is
the folder to publish and `--prod` publishes to the live address instead of a draft
([Netlify CLI: deploy](https://cli.netlify.com/commands/deploy/)).

## Elsewhere, option B: Cloudflare Pages

### Drag and drop

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com) (a free account is enough).
2. **Workers & Pages** → **Create application** → **Get started** → **Drag and drop your files**.
3. Enter a project name (for example `lately`), drag the `docs/site` folder in, and select
   **Deploy site**. The site is served at `https://<project-name>.pages.dev`.

To update later: open the project → **Create a new deployment** → Production → drag the
rebuilt folder.

Limits: 1,000 files and 25 MiB per file for drag and drop; the folder has 7 small files. A
drag-and-drop project cannot be switched to Git deploys later, which does not matter here
([Cloudflare Pages: Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)).

### Command line (optional)

```bash
npx wrangler login
npx wrangler pages project create
npx wrangler pages deploy ../docs/site
```

Cloudflare serves `privacy.html` at `/privacy` and redirects `/privacy.html` there
([Cloudflare Pages: serving pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)).

## The URLs to paste into Play Console

Replace the host with yours. Open each one on a phone, in a private window, before pasting:
it must load without signing in.

| Play Console field | GitHub Pages | Netlify | Cloudflare Pages |
|---|---|---|---|
| Store settings → Website | `https://mitovoid-ai.github.io/lately/` | `https://<name>.netlify.app/` | `https://<project>.pages.dev/` |
| App content → Privacy policy | `https://mitovoid-ai.github.io/lately/privacy.html` | `https://<name>.netlify.app/privacy.html` | `https://<project>.pages.dev/privacy` |
| App content → Data safety → Data deletion (delete account URL) | `https://mitovoid-ai.github.io/lately/delete-account.html` | `https://<name>.netlify.app/delete-account.html` | `https://<project>.pages.dev/delete-account` |

Also put these in `listing.md` and `data-safety.md` where they say `[PUBLIC SITE URL]`.

## A custom domain later

Pages can move to your own domain (for example `lately.yourdomain.com`) at any time. The
`netlify.app` or `pages.dev` address keeps working, but update the three Play Console
fields above to the new address the same day.

- **Netlify:** the project → **Domain management** → **Add a domain** → **Add a domain you
  already own**. At your DNS provider, a subdomain gets a CNAME record pointing to
  `<name>.netlify.app`; a bare domain gets an ALIAS to `apex-loadbalancer.netlify.com` or an A
  record to `75.2.60.5`. HTTPS is set up automatically once DNS works; allow up to 24-48 hours
  ([Netlify: domains](https://docs.netlify.com/manage/domains/get-started-with-domains/)).
- **Cloudflare Pages:** the project → **Custom domains** → **Set up a domain**. A subdomain
  needs a CNAME to `<project>.pages.dev` at your DNS provider; a bare domain must use
  Cloudflare's nameservers. Add the domain in Pages **before** creating the CNAME, or it
  shows a 522 error ([Cloudflare Pages: custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)).

## When the legal text changes

1. Edit `frontend/legal/privacy.md` or `terms.md` (and its "Last updated" date).
2. From `frontend`: `node scripts/build-legal.js` (updates the app's copy and `docs/site/`).
3. Push to `main`: the `pages` workflow redeploys GitHub Pages. On Netlify or Cloudflare, upload
   `docs/site/` again instead. The app and the website then show the same text.
