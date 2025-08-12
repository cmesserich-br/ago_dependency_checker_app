# ArcGIS App Dependency Explorer

A zero-backend, single-page web app that reveals the **true data dependencies** behind ArcGIS items (Web Maps, Dashboards, Experiences, StoryMaps, Web AppBuilder apps, Feature/Scene items, and raw Service URLs). Paste any ArcGIS Online/Enterprise URL or 32-char item ID, and the app:

- Fetches the item + configuration
- Extracts dependent items and service URLs
- Renders an interactive dependency graph
- Lists all discovered items with quick links
- Exports results to CSV/JSON

It’s fast, minimal, privacy-friendly (no server!), and built for analysts who need to quickly map “what powers what.”

---

## ✨ Features

- **Smart URL/ID detection**  
  Works with common patterns for Web Maps, Dashboards, Experience Builder, StoryMaps, Web AppBuilder, and direct item IDs. Normalizes `experience.arcgis.com` / `storymaps.arcgis.com` to the correct portal when needed.

- **Deep parsing per type**
  - **Web Map**: pulls layer/table item IDs + service URLs
  - **Dashboard**: scans config for embedded item IDs
  - **Experience Builder**: inspects `dataSources`, `mapViews`, and embedded links
  - **StoryMaps**: parses root `story` JSON + `dataSources`, finds embedded map/webscene refs and links
  - **Web AppBuilder**: follows the webmap and traverses its dependencies
  - **URLs**: attached to root as “URL” nodes when no itemId is present

- **Interactive dependency graph** (Cytoscape + Dagre)
  - Clean node shapes, **vibrant type colors** (light/dark modes)
  - Fixed-height, **full-screen canvas** with centered initial layout
  - **Legend chips** with counts + type filters
  - **Fit / Expand Web Maps / Collapse URLs / Clear selection**
  - **Focus mode on selection**: fade unrelated nodes/edges; local reflow to reduce edge crossings
  - **Export graph to PNG**

- **Unified search filter**  
  A single search box that **filters both the graph and the Discovered Items list** live. Supports:
  - Free text (AND across tokens)
  - Key filters: `title:"..." type:... owner:... id:...`
  - Quotes for exact phrases

- **Discovered Items list**  
  Compact list with sticky header, in-panel search, item type + ID, and direct links to **Item page** and (when relevant) **REST**/**Service**.

- **Auth for private content**  
  Inline accordion with **Portal URL**, username/password, and “Generate token.”  
  Auto-opens when a private item is detected. Uses either `referer` (default) or `requestip` (optional for local dev).

- **Exports**
  - **CSV** with analyst-friendly columns (parents, URLs, timestamps, keywords)
  - **JSON** of the entire dependency object

- **Privacy-first**
  - No backend. All requests go from your browser directly to the ArcGIS REST API.
  - Tokens are stored **in memory only** (not persisted).

---

## 📁 Project Structure

```
/ (static site)
├─ index.html      # App shell & layout
├─ styles.css      # Theme variables, layout, components, dark mode
└─ app.js          # All logic: parsing, fetch, graph, filters, exports, auth
```

No bundler required. Open with a local web server.

---

## 🚀 Quick Start (Local)

Use any static server. Two easy options:

**VS Code Live Server**
1. Open the folder in VS Code.
2. Install the “Live Server” extension.
3. Right-click `index.html` → “Open with Live Server”.

**Python**
```bash
# Python 3
python -m http.server 5500
# then open http://localhost:5500
```

> Tip: If your org restricts tokens to IP/referer, try the **Use requestip** checkbox when generating tokens for local testing.

---

## 🧭 How to Use

1. **Paste** an ArcGIS item URL or 32-char item ID in the top input.  
   Examples: Web Map, Dashboard, Experience, StoryMap, Web AppBuilder app, or even a REST item URL.

2. Click **Analyze**.  
   - If the item is **private**, the **Authentication** section will auto-open with clear steps.  
   - Enter **Portal URL** (for ArcGIS Enterprise), **username/password**, click **Generate token**, then **Analyze** again.

3. Explore results:
   - **Graph**: use the toolbar (Fit, Expand Web Maps, Collapse/Show URLs, Clear selection). Click nodes to focus details and dim the rest.  
   - **Discovered Items**: browse the list, use the in-panel search (same filter as graph), open item/REST/service links.  
   - **Summary**: basic info about the root item.  
   - **Raw JSON**: the full dependency payload you can share or inspect.

4. **Export**:
   - **CSV**: item lineage with parents, service URLs, timestamps
   - **JSON**: full dependency object
   - **PNG**: image of the graph

---

## 🔎 Search & Filter Syntax

- **Free text**: `parcels utilities` (finds items whose *title/type/owner/id/keywords* contain both tokens)
- **Keyed filters**:
  - `type:"Web Map"`
  - `owner:gis_admin`
  - `title:"flood risk"`
  - `id:abc123...`
- Combine freely:  
  `type:dashboard owner:planning "capital projects"`

Filters apply **live** to **both** the graph and the discovered items panel.

---

## 🔐 Authentication Notes

- **Portal URL**  
  - ArcGIS Online: default is `https://www.arcgis.com`  
  - ArcGIS Enterprise: enter your base portal, e.g. `https://portal.myorg.gov/portal`
- **Token generation**
  - Default: `client=referer` (uses the site origin)
  - Optional: `client=requestip` for local development testing
- Tokens are **held in memory** only and cleared on refresh.

> If your org enforces web-tier auth or custom token services, you may need to sign in in a separate tab or use a proxy. This app doesn’t proxy or store credentials.

---

## 📤 CSV Columns

Each exported row is either an **Item** or **URL** node.

**Common:**
- `NodeType` (Item | URL)
- `Title`
- `Type`
- `Owner`
- `Portal` (host)
- `ItemURL`
- `RESTURL`
- `ServiceURL`
- `ParentIDs` (semicolon-separated)
- `ParentTitles` (semicolon-separated)

**Items only:**
- `ItemID`
- `Access`
- `CreatedISO`
- `ModifiedISO`
- `TypeKeywords` (semicolon-separated)

> Parents are computed from graph edges so analysts can trace “what references this.”

---

## 🧠 How It Works (Brief)

- For the root item, we call the ArcGIS REST API:
  - `/sharing/rest/content/items/{id}`
  - `/sharing/rest/content/items/{id}/data` (for config-type items)
- We then parse item-type specific JSON:
  - **Web Map**: `operationalLayers[].{itemId,url,layers,tables}`
  - **Dashboard**: deep scan for `itemId`
  - **Experience Builder**: `dataSources`, `mapViews`, embedded `itemId`s/links
  - **StoryMaps**: `story`, `dataSources`, `webmap/webscene/mapId`, embedded links
  - **Web AppBuilder**: follow `map.itemId` then traverse that Web Map
- Collected item IDs become **nodes**; references become **edges**; URLs with no item ID become URL nodes.

---

## 🧩 Supported Types

- Web Map
- Dashboard
- Experience (Experience Builder)
- StoryMap
- Web AppBuilder (Web Mapping Application)
- Feature / Scene items (as discovered dependencies)
- Raw Service URLs

> If you hit an unsupported or custom app, the raw JSON and discovered URLs still help you pivot.

---

## 🛠 Troubleshooting

- **Nothing happens on Analyze**
  - Check the browser console for network errors.
  - Private content? The **Authentication** section should auto-open. Generate a token and retry.
- **Enterprise portal**  
  - Ensure the **Portal URL** is correct (no trailing slash). Example: `https://portal.myorg.gov/portal`
- **Links open to blank portal page**  
  - The README logic uses the right `/sharing/rest` endpoints and includes the token when relevant. If your org blocks token on referer, try **Use requestip**.
- **Graph looks cramped**  
  - Use **Expand Web Maps** then **Fit**; click a node to focus; use the legend chips to filter by type; refine with the search box.
- **Dark mode links are hard to read**  
  - We ship with high-contrast link colors in dark mode. If your brand requires different colors, tweak `--link` & `--link-hover` in `styles.css`.

---

## 📦 Dependencies

- [Cytoscape.js](https://js.cytoscape.org/) — graph rendering
- [cytoscape-dagre](https://github.com/cytoscape/cytoscape.js-dagre) — directed layout
- Native browser `fetch` & `URLSearchParams` (no polyfills required for modern browsers)

All loaded from CDNs via `<script>` tags in `index.html`.

---

## 🧭 Roadmap Ideas

- Scene/WebScene deep traversal
- Saved views (shareable filters)
- More per-type enrichments in the details panel
- Optional proxy mode for locked-down enterprises

---

## 📝 License

Choose a license for your repo (MIT recommended).  
Until then, this code is provided “as is.”

---

## 🙌 Credits

Designed with analysts in mind. Thank you for all the iteration notes and real-world test links—this tool improved a ton because of that feedback.

If you want, I can generate a **mini GIF demo** (PNG sequence) you can drop into the README.
