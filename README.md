cfb-data-api
---

## Development

`npm install` will install all Node dependencies, while `pip install -r requirements.txt` installs all Python deps.

Running Node server: `npm run start` --> will run on port 5000
Running Python server: `python app.py` --> will run on port 8000

Test using Postman -- Send a GET request to `localhost:5000/cfb/pbp?gameId=<ESPN gameId>`.

## To-Do:

- [] Docker container to encapsulate both services
- [X] Data manipulation to get epEnd input variables
- [] Figure out how to get timeouts and calculate ExpScoreDiff for WPA
- [] Frontend pages?
- [] Test requests during a live game