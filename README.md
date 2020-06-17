# Gnosis Liquidity Provision

We want to employ different liquidity strategies when the Gnosis Protocol is launched.
This repo is responsible for testing and execution.

The code is this repository is _work in progress_: it will be subject to significant changes and has known rough edges that break some functionalities.
Do not use unless you fully understand the code!

## How to use

Install needed dependencies:

```
yarn install
```

Note that the installation might be successful even if errors are shown in the console output.
In case of doubt, running `echo $?` immediately after `yarn install` should return 0 if the installation was successful.

Build Truffle artifacts:

```
yarn build
```

This concludes the setup procedures.
Any liquidity provision script can be run at this point.
See `scripts/README.md` for details.

## How to test

Start and keep the test Ethereum network running in the background:

```
yarn testnet
```

Run tests:

```
yarn test
```

Use scripts as described in [scripts/README.md](scripts/README.md)`.

## Synthetix Spread Orders

This service requires a service that runs a script every 5 minutes. We have configured this to run inside a Docker container that can be interacted with as follows:

```sh
docker build -t gnosispm/dex-liquidity-provision .
docker run -e PK=$YOUR_PRIVATE_KEY -t gnosispm/dex-liquidity-provision:latest "truffle exec scripts/synthetix/facilitate_trade.js --network rinkeby"
```
