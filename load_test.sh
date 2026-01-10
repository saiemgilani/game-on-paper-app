#!/bin/bash
docker compose stop
docker compose up --build -d

echo "Waiting for the app to come up..."
sleep 5 # wait for the app to come up

echo "Spinning up N Chrome instances..."
for i in {1..15}
do
 open -na "Google Chrome" --args -incognito "http://localhost:8000/cfb/game/401778302"
done

echo "Waiting for all Chrome instances to load..."
sleep 5 # wait for the app to come up

echo "Test over, killing app"
docker compose stop