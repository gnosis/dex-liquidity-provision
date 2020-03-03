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

Use scripts as described it `scripts/README.md`.