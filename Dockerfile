FROM nikolaik/python-nodejs

WORKDIR /src

COPY . .

RUN cd ./python && pip install --no-cache-dir -r requirements.txt

RUN cd ./api && npm install

RUN cd ./frontend && npm install

EXPOSE 8000

ENV RDATA_BASE_URL=http://0.0.0.0:7000
ENV API_BASE_URL=http://0.0.0.0:5000
ENV NODE_DEBUG=[frontend]

CMD cd ./frontend && npm run start
