FROM node:latest

WORKDIR /src

COPY ./frontend/package.json ./
RUN npm install

COPY ./frontend .

EXPOSE 8000

CMD ["npm", "run", "start"]