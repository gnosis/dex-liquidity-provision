# Gnosis Liquidity Provision

We want to employ different liquidity strategies when the Gnosis Protocol is launched.
This repo is responsible for testing and execution.

The code is this repository is _work in progress_: it will be subject to significant changes and has known rough edges that break some functionalities.
Do not use unless you fully understand the code!

## How to use

Install needed dependencies:

```sh
yarn install
```

Note that the installation might be successful even if errors are shown in the console output.
In case of doubt, running `echo $?` immediately after `yarn install` should return 0 if the installation was successful.

Build Truffle artifacts:

```sh
yarn build
```

This concludes the setup procedures.
Any liquidity provision script can be run at this point.
See `scripts/README.md` for details.

## How to test

Start and keep the test Ethereum network running in the background:

```sh
yarn testnet
```

Run tests:

```sh
yarn test
```

Use scripts as described in [scripts/README.md](scripts/README.md)`.

## Synthetix Liquidity Provision

This service requires a service that runs a script every 5 minutes. We have configured this to run inside a Docker container that can be interacted with as follows:

```sh
docker build -t gnosispm/dex-liquidity-provision .
docker run -e PK=$YOUR_PRIVATE_KEY -t gnosispm/dex-liquidity-provision:latest "truffle exec scripts/synthetix/facilitate_trade.js --network rinkeby"
```

## Safe Token Distribution

Create your own transferFile, or use our sample [examples/sampleTransferFile.json](examples/sampleTransferFile.json).
With a fundAccount (aka Gnosis Safe) containg sufficient funds that you own execute:

```sh
 export PK=<your private key>
export INFURA_KEY=<your infura key>
export FUND_ACCOUNT=<your gnosis safe>
export TRANSFER_FILE=<path to your transfer file>
```

Alternatively, there is a sample [.sample_env](.sample_env) file that is not tracked by the project where you can paste these values, rename to `.env` (i.e. `mv .sample_env .env`) source via `source .sample_env`

With all configuration in place, we are ready to run the script.

```sh
npx truffle exec scripts/airdrop.js --fundAccount=$FUND_ACCOUNT --transferFile=$TRANSFER_FILE --network=$NETWORK_NAME

```

Then, you will be provided with logs containing all the transfer details followed by a prompt asking "Are you sure you want to send this transaction to the EVM?"

Selecting yes yields a link to the Gnosis Safe interface where the transaction can be signed and executed.

To do a "verification" run simply add the argument `--verify` and observe the difference in the last two lines of the logs emitted.

Note that, the gas costs for such transactions can vary based on the tokens you are transfering (since each token could potentially implement their transfer's differently).
