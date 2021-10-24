FROM nikolaik/python-nodejs:python3.9-nodejs17 as base

WORKDIR /root/src

COPY ./python/requirements.txt ./python/requirements.txt
COPY ./frontend/package.json ./frontend/package.json

# ---- Dependencies ----
FROM base AS pybuilder
RUN cd ./python && pip install --user -r requirements.txt

# install node packages
FROM base AS nodebuilder
RUN cd ./frontend && npm set progress=false && npm config set depth 0
RUN cd ./frontend && npm install
 
FROM base
WORKDIR /code

COPY --from=nodebuilder /root/src/frontend/node_modules ./frontend/node_modules
COPY --from=pybuilder /root/.local /root/.local

COPY frontend ./frontend
COPY python ./python

EXPOSE 8000

ENV RDATA_BASE_URL=http://0.0.0.0:7000
ENV NODE_DEBUG=[frontend]

CMD cd ./frontend && node ./server.js
