# Game on Paper
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```Shell
$ docker build -t gopapp .
$ docker run --rm -d -it -p 8000:8000 --name=game-on-paper --memory=2g --cpus=2.0 gopapp 
```

This will setup the container just like how it would run on Google Cloud Run, installing all python and node dependencies and starting all three services in a Docker container.

Test API requests using Postman -- Send a GET request to `localhost:5000/cfb/pbp/<ESPN gameId>`.
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
- [ ] Postgame win probabilities