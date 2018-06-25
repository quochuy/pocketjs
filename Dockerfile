FROM node:8

ENV TZ=Australia/Sydney
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

COPY ./bot /opt/pocketjs

WORKDIR /opt/pocketjs

RUN npm install