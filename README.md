# Game on Paper
---

## Prerequisites

Make sure you have the following installed:

- [Node and NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- [Docker](https://www.docker.com/products/docker-desktop/)
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

You will need to create a `.env` file in the `.astro` folder, following the example of `.env.example`. The credentials and how to acquire them are listed below:

- `SDV_AUTH_TOKEN`: Please reach out to [@akeaswaran](https://github.com/akeaswaran) or [@saiemgilani](https://github.com/saiemgilani) for access to the Sportsdataverse web platform, where you can get a API token.
- `PYTHON_HTTP_TOKEN`: please leave this as `test-token`. If you do change this, make sure the change is replicated in `./docker-compose.yml`.
- `PYTHON_HTTP_URL`: please leave this as `http://localhost:8080`.

## Setup

#### Quickstart

You can run `scripts/run.sh` from the root of this repository to install all dependencies, build Docker images, and start the servers.

Note: if you use this option, you will have to stop the Docker containers manually (either via the Docker Dashboard or via `docker stop`).

### Web (frontend) Development

The frontend is written using the JS framework [`Astro`](https://astro.build). To setup your environment, `cd` into the repo and run the following commands:
```sh
$ cd ./astro
$ npm install --save
```

This will install all dependencies and setup `astro` as an available command. From there, you can run:
```sh
$ npm run dev
```

to start the development server, which will hot-reload with any changes you make.

More on Astro and its Cloudflare integration: https://docs.astro.build/en/guides/integrations-guide/cloudflare/

### API (backend) Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```sh
$ docker compose pull && docker compose up --build
```

This will setup the containers to run under the same constraints as in DigitalOcean.

You can make sure the API is live by sending a HTTP GET to http://localhost:8080/healthcheck via Postman.
