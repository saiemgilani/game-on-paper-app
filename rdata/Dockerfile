FROM rocker/tidyverse:4.0.3

WORKDIR /src


# Install R packages
RUN install2.r --error \
    plumber \
    mgcv \
    logger \
    tictoc \
    xgboost \
    dplyr

RUN installGithub.r \
    saiemgilani/cfbscrapR

COPY ./rdata .

EXPOSE 7000

CMD ["Rscript", "server.R"]