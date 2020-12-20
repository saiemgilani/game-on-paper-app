FROM rocker/tidyverse:latest

WORKDIR /src

COPY . .

# Install R packages
RUN cd ./rdata
RUN install2.r --error \
    plumber \
    mgcv \
    logger \
    tictoc \
    xgboost \
    dplyr

RUN installGithub.r \
    saiemgilani/cfbscrapR

RUN apt-get update && apt-get -y install curl
RUN curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
RUN apt-get update && sudo apt-get install -y nodejs

RUN cd ./api && npm install

RUN cd ./frontend && npm install

EXPOSE 8000

# HEALTHCHECK --interval=1m30s --timeout=10s --retries=3 --start-period=30s \
#     CMD curl -f http://localhost:5000/cfb/healthcheck || exit 1

RUN cd ./ && chmod +x ./start.sh
CMD ["./start.sh"]
