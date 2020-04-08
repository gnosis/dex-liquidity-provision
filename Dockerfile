FROM node:10.15-alpine

RUN apk add --no-cache --virtual build-dependencies bash git python make g++ ca-certificates

COPY package.json .
RUN yarn && yarn global add truffle && yarn cache clean

COPY . .

ENTRYPOINT ["bash", "-c"]
