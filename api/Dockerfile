FROM node:latest

WORKDIR /src

COPY ./api/package.json ./
RUN npm install

COPY ./api .

EXPOSE 5000

CMD ["npm", "run", "start"]