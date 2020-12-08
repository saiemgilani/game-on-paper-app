FROM nikolaik/python-nodejs:latest

WORKDIR /src

COPY requirements.txt ./
COPY package.json ./
RUN pip install --no-cache-dir -r requirements.txt
RUN npm install

COPY . .

CMD ./run.sh