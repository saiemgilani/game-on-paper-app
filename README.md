# Game on Paper
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```Shell
$ docker compose pull && docker compose up --build
```

This will setup the containers just like how they are run on DigitalOcean..

Test API requests using Postman -- Send a POST request to `localhost:8000/cfb/<ESPN gameId>`.
Test the frontend using a browser -- load up `localhost:8000/cfb`.

See Issues tab for more details on things in flight.
