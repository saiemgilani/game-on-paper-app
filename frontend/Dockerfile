FROM node:17 as base

WORKDIR /root/src

COPY ./package.json ./package.json

# install node packages
FROM base AS nodebuilder
RUN npm set progress=false && npm config set depth 0
RUN npm install
 
FROM base
WORKDIR /code

COPY --from=nodebuilder /root/src/node_modules ./node_modules

COPY . ./

CMD node ./server.js
