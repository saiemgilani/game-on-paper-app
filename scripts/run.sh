#!/bin/sh

docker compose pull && docker compose up --build -d;
cd ./astro && npm install --save && npm run dev;