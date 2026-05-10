# Claw Machine

A small Three.js claw-machine game served by a single static Go binary.
Designed for mobile (touch d-pad + drop button) and desktop (arrow keys / WASD + space).

## Run locally

```sh
go run . -port 8090
```

Open http://localhost:8090

## Controls

- **Move**: on-screen d-pad, or arrow keys / WASD
- **Drop**: red DROP button, or Space / Enter
- The claw lowers, attempts a grab, raises, returns to the gold-ringed chute and releases.
  Prizes that fall into the chute count toward your score.

## Layout

```
/main.go        Go server, embeds web/ via go:embed
/web/index.html
/web/style.css
/web/app.js     Three.js scene, simple physics, game loop
```

## Deployment with serverGitUpdater

This repo ships two files for [serverGitUpdater](https://github.com/S95F/serverGitUpdater):

- `config.example.json` — full server-level + per-app config; copy to
  `config.json` next to the updater binary.
- `.servergitupdater.json` — in-repo overrides applied on each pull when
  `import_from_repo_file` is enabled.

Both build with `go build -o {repo_path}/{name}` and launch the resulting
binary as `clawmachine -port {port}`. Caddy proxies the chosen domain to
`127.0.0.1:{port}`.
