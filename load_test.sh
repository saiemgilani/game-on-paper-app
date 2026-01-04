#!/bin/bash
docker compose stop
docker compose up --build -d

wait 15 # wait for the app to come up

for i in {1..15}
do
 open -na "Google Chrome" --args -incognito "http://localhost:8000/cfb/game/401778302"
done

# docker compose stop