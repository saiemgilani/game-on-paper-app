# Game on Paper
---

## Web (frontend) Development

The frontend is written using the JS framework [`Astro`](https://astro.build). Make sure you have [Node and NPM installed](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). To setup your environment, `cd` into the repo and run the following commands:
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

## API (backend) Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```sh
$ docker compose pull && docker compose up --build
```

This will setup the containers just like how they are run on DigitalOcean.

You can make sure the API is live by sending a HTTP GET to http://localhost:8080/healthcheck via Postman.
