# Docker deployment

From the repository root:

```sh
npm run docker
```

This runs:

```sh
docker compose --project-directory . -f deploy/compose.yml up --build
```

The explicit project directory keeps the build context, root `.env` configuration and Compose project name tied to the checkout directory. Keep the same checkout directory name when reusing an existing Compose data volume.

The Dockerfile-specific ignore file, `Dockerfile.dockerignore`, excludes Git history, environment files, runtime records, dependencies and the native miniapp from the image build context. The application still starts with `apps/web/server.js` inside the image.

The demo is the default. To connect a model, configure the root `.env` as described in the [quickstart](../README.md#quickstart). Set `PUBLIC_ORIGIN` to your exact HTTPS origin when placing the service behind a reverse proxy. The published port binds to loopback and application records use the named `companion-data` volume.

Inspect configuration without building or starting a container:

```sh
docker compose --project-directory . -f deploy/compose.yml config --quiet
```
