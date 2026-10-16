# Subsearch

Search every video from the YouTube channels you subscribe to.

YouTube searches all of YouTube, or one channel at a time. Subsearch searches only your subscriptions. Try it at [icelsupreme.github.io/Subsearch](https://icelsupreme.github.io/Subsearch/).

## How it works

Subsearch is a static site with no server. Everything runs in the browser:

1. You sign in with Google. Subsearch asks only for read access to your YouTube account (`youtube.readonly`).
2. Subsearch reads your subscriptions, then downloads each channel's upload list with the YouTube Data API: titles, the first 500 characters of each description, dates, and privacy status. Thumbnails load straight from YouTube by video ID.
3. The lists are saved in the browser's IndexedDB. Later syncs download only videos that are newer than the saved ones.
4. Searches run in a web worker, so typing never waits for a search.

Each channel's saved data is deleted 30 days after its first full download, as the YouTube API Services policies require; the next sync downloads it again. The page footer shows the last sync date and the next expiry date, and a notice appears 3 days before data expires. **Delete data** clears everything and signs you out.

### Quota

All users share the Google Cloud project's daily YouTube API quota of 10,000 units. Each request returns up to 50 items and costs 1 unit. For example, a first sync of 200 channels with 1,000 videos each costs about 4,000 units.

### Search ranking

Every word in the query must appear in the title, description, or channel name. Results are ranked by these points:

| Match | Points |
|---|---|
| Word in the title, as a whole word | 15 |
| Word in the title, inside a longer word | 10 |
| Word in the channel name | 6 |
| Word in the description | 2 |
| Exact title | +100 |
| Full phrase in the title | +50 |
| Full phrase in the description | +10 |

Ties go to the newest video. `test/search.test.js` checks this order.

## Project structure

| Path | Contents |
|---|---|
| `index.html` | The search page. |
| `changelog/index.html` | The user-facing changelog page. |
| `privacy/index.html` | The privacy policy. |
| `terms/index.html` | The terms of use. |
| `js/app.js` | Sign-in, sync, filters, and results. |
| `js/worker.js` | The search worker. |
| `js/search.js` | Ranking and the private-video check, shared with the tests. |
| `js/db.js` | IndexedDB access. |
| `js/toast.js` | Notices for sync progress, loading, and errors. |
| `js/theme.js` | Applies the saved theme before the page paints. |
| `css/input.css` | Tailwind source with the brand tokens. |
| `img/` | Logo, favicon, social card, and touch icon. |
| `brand/og.html` | Source of the social card. |
| `test/` | Tests for the search ranking. |

## Develop

Requirements: Node.js 22 or later.

```
npm install
npm run watch    # rebuild css/app.css on change
npm start        # serve the site at http://localhost:8000
npm test         # run the tests
npm run lint     # check code with Biome
npm run format   # format and fix code with Biome
```

`npm run build` writes the minified `css/app.css`. The file isn't committed.

## Google Cloud setup

Sign-in needs an OAuth client in a Google Cloud project:

1. Turn on **YouTube Data API v3**.
2. On the OAuth consent screen, add the `youtube.readonly` scope. While the app is in **Testing** mode, only listed test users can sign in, up to 100.
3. Create an OAuth client of type **Web application**. Under **Authorized JavaScript origins**, add `http://localhost:8000` and `https://icelsupreme.github.io`.
4. Put the client ID in `CLIENT_ID` in `js/app.js`. The client ID is public. The app doesn't use the client secret.

## Deploy

Every push and pull request runs `.github/workflows/ci.yml`: lint, tests, and the CSS build. A push to `main` also deploys the site to GitHub Pages. In the repo settings, under **Pages**, set **Source** to **GitHub Actions**.

## Releases

- Versions follow [Semantic Versioning](https://semver.org/). The version appears in `package.json` and in the header badge of every page.
- The changelog page follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). It lists only changes that users see on the site.

## Brand

- `img/logo.svg`: the brand icon, also used as the favicon.
- `img/og.png`: the social card, rendered from `brand/og.html` at 1200 × 630.
- `img/apple-touch-icon.png`: the logo at 180 × 180 on the ink background.

| Color | Hex | Use |
|---|---|---|
| Cream | `#fffcf2` | Light page background, dark text |
| Sand | `#ccc5b9` | Light borders, dark secondary text |
| Ash | `#403d39` | Light secondary text, dark borders |
| Ink | `#252422` | Light text, dark page background |
| Flame | `#eb5e28` | Accent. Use ink text on flame; cream text on flame fails contrast. |

Font: Plus Jakarta Sans, with Noto Sans Hebrew and Noto Sans Arabic for those scripts. Icons: [Phosphor](https://phosphoricons.com/), regular weight.

## License

[MIT](LICENSE)
