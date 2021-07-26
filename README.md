# Game on Paper
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```Shell
$ docker compose up --build
```

This will start up both the Python and Node services in networked containers, installing all necessary dependencies in said containers. The Python container will not be exposed to the host (bare metal) machine.

Test the frontend using a browser -- load up `localhost:8000/cfb`.

## To-Do:

- [X] Docker container to encapsulate both services
- [X] Data manipulation to get epEnd input variables
- [X] Figure out how to calculate ExpScoreDiff for WPA
- [X] Figure out how to get timeouts for WPA
- [X] Frontend pages
- [X] Advanced Box Scores
- [X] Test requests during a live game
- [X] Better home page
- [X] EPA in box scores