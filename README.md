# Prowlarr Easy for Hayase

A simpler public-install Hayase extension for people who just want one clean setup:

- install one public `manifest.json`
- enter one Prowlarr endpoint
- enter one Prowlarr API key
- done

This repo intentionally avoids per-site scraping and instead uses your own Prowlarr Torznab endpoint.

## Install URL

Add this repository URL in Hayase:

```text
https://cdn.jsdelivr.net/gh/melral/hayase-prowlarr-easy@main/manifest.json
```

In Hayase:

1. Open `Settings`
2. Open `Extensions`
3. Open `Repositories`
4. Add the manifest URL above
5. Install `Prowlarr Easy`
6. Open the extension settings
7. Fill in:
   - `endpoint`
   - `apiKey`
   - optional `categories`

## Example Endpoint

```text
https://prowlarr.example/api/v1/indexer/all/results/torznab/api
```

## Why this version exists

The other repo is more flexible and aimed at advanced users with multiple endpoints.
This one is aimed at normal users who want the easiest legit setup with the least friction.

## Notes

- default category `5070` is the common Torznab anime category
- the extension prefers identifier searches when TVDB, IMDb, or TMDB IDs are available
- results without a stable torrent hash are skipped because Hayase expects a stable hash
