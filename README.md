# Gnosis Liquidity Provision

We want to employ different liquidity strategies when the Dfusion exchange is launched.
This repo is responsible for testing and execution.

The code is this repository is *work in progress*: it will be subject to significant changes and has known rough edges that break some functionalities.
Do not use unless you fully understand the code!

## How to use

Install needed dependencies:

```
yarn install
```

Run Ganache in the background with an increased gas limit (this is needed to deploy Dfusion):

```
npx ganache-cli --gasLimit=80000000
```

Run test:
```
npx truffle test
```

Use scripts as described in `scripts/README.md`.

## Synthetix Spread Orders

This service requires a service that runs a script every 5 minutes. We have configured this to run inside a Docker container that can be interacted with as follows:

```sh
docker build -t gnosispm/dex-liquidity-provision .
docker run -e PK=$YOUR_PRIVATE_KEY -t gnosispm/dex-liquidity-provision:latest "truffle exec scripts/synthetix/facilicate_trade.js --network rinkeby"
```
