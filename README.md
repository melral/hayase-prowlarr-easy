# Prowlarr Easy for Hayase

A Hayase torrent extension that searches through your own Prowlarr setup instead of scraping sites directly.

This version is built for normal installs:

- one public `manifest.json`
- one Prowlarr URL
- one Prowlarr API key
- optional local proxy helper if Hayase cannot reach your local HTTP server directly

## What You Need

- a working Prowlarr instance
- at least one enabled torrent indexer in Prowlarr
- your Prowlarr API key
- Hayase

## Install URL

Add this repository in Hayase:

```text
https://cdn.jsdelivr.net/gh/melral/hayase-prowlarr-easy@main/manifest.json
```

## Hayase Setup

1. Open `Settings`
2. Open `Extensions`
3. Open `Repositories`
4. Add the install URL above
5. Install `Prowlarr Easy`
6. Open the extension settings
7. Fill in:
   - `endpoint`
   - `apiKey`
   - optional `maxResults`
   - optional `categories`
   - optional `proxyBaseUrl`

## Endpoint Formats

`endpoint` accepts any of these:

```text
http://192.168.x.x:9696
https://prowlarr.example.com
https://prowlarr.example.com/prowlarr
https://prowlarr.example.com/1/api
https://prowlarr.example.com/api/v1/indexer/all/results/torznab/api
```

If you enter the base Prowlarr URL, the extension will automatically discover your enabled torrent indexers and search across them.

If you want the fastest possible setup, use a direct indexer endpoint such as:

```text
http://192.168.x.x:9696/1/api
```

That skips indexer discovery and only searches that one Prowlarr indexer.

## Recommended Settings

For a normal home setup:

```text
endpoint: http://192.168.x.x:9696
apiKey: your Prowlarr API key
maxResults: 10
categories: 5070
strictEpisodeMatching: true
proxyBaseUrl:
```

## Connection Check

The extension's test flow now verifies:

- your URL is valid
- your API key is accepted
- Prowlarr exposes at least one enabled searchable torrent indexer
- at least one Torznab `caps` endpoint really responds

If the status test fails, the error should now be much more specific:

- invalid API key
- wrong endpoint path
- search timeout
- missing enabled torrent indexers

## Optional Local Proxy Helper

Some Hayase environments cannot fetch a local HTTP Prowlarr server directly from a secure app/webview.
If search fails with a generic fetch/network error, run the helper in this repo and set `proxyBaseUrl`.

### Start The Helper

```bash
python3 serve.py
```

That starts a local helper on:

```text
http://127.0.0.1:8765
```

Then set this in Hayase:

```text
proxyBaseUrl: http://127.0.0.1:8765
```

### When You Need It

Use the helper only if:

- Hayase says `Failed to fetch`
- Hayase can load the extension but cannot reach your local Prowlarr
- your Prowlarr is only available over plain `http://` on your LAN

If direct access already works, leave `proxyBaseUrl` empty.

## How Search Works

- prefers identifier searches when TVDB, IMDb, or TMDB IDs are available
- falls back to title searches
- can search multiple enabled Prowlarr torrent indexers automatically
- caches discovered indexers for faster repeated searches
- searches indexers in parallel per search plan instead of fully serializing everything
- drops timed-out endpoints for the rest of the current search
- rejects mismatched episode numbers more aggressively so episode 1 does not accidentally resolve to episode 2
- prefers season-local episode numbers for titles that already include season context, instead of overusing absolute episode fallbacks
- hard-rejects obvious single-search batch/range results such as `01-12`, `E01-E02`, `complete`, or `season pack`
- skips results without a stable torrent hash
- defaults to category `5070`, the common Torznab anime category
- defaults to `maxResults: 10` for better latency in Hayase

## Security Notes

- do not commit or publish your real API key
- prefer a LAN IP or HTTPS reverse proxy instead of exposing Prowlarr openly to the internet
- if you accidentally shared your API key, regenerate it in Prowlarr

## Files

- [manifest.json](./manifest.json): Hayase extension manifest
- [dist/prowlarr.js](./dist/prowlarr.js): extension code
- [serve.py](./serve.py): optional local proxy helper
