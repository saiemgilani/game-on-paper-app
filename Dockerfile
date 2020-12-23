FROM nikolaik/python-nodejs

WORKDIR /src

COPY . .

RUN cd ./python && pip install --no-cache-dir -r requirements.txt

RUN cd ./api && npm install

RUN cd ./frontend && npm install

EXPOSE 8000

# HEALTHCHECK --interval=1m30s --timeout=10s --retries=3 --start-period=30s \
#     CMD curl -f http://localhost:5000/cfb/healthcheck || exit 1

RUN cd ./ && chmod +x ./start.sh
CMD ["./start.sh"]
