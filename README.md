# startup-gyaan-media

Media and cloud publisher for [@startupgyaan.daily](https://www.instagram.com/startupgyaan.daily/).
`queue.json` + `videos/` hold clips queued from the Mac (`startup-gyaan/scripts/sync-cloud.mjs`); `.github/workflows/publish.yml`
posts one per run; `state/published.json` records what went out. A `PAUSED` file in the root stops all posting.
