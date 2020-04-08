FROM node:10.15-alpine

RUN apk add --no-cache --virtual build-dependencies bash git python make g++ ca-certificates
COPY package.json .
RUN yarn
# Quick-fix to strange local truffle error.
RUN yarn global add truffle

COPY . .

ARG NETWORK
ENV evm_network=$NETWORK
# Run the command on container startup
# TODO - replace rinkeby with dynamic env variable
CMD [ "sh", "-c", "truffle exec scripts/synthetix/facilicate_trade.js --network $evm_network" ]
