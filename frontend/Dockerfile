FROM node:latest

WORKDIR /src

COPY ./package.json ./
RUN npm install

COPY . .

EXPOSE 8000
EXPOSE 5000
EXPOSE 7000

CMD ["npm", "run", "start"]