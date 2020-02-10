# Gnosis Liquidity Provision - Code

We want to employ different liquidity strategies when the Dfusion exchange is launched.
This repo is responsible for testing and execution.

More details on the process and implementation can be found in the file `design.md`.

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