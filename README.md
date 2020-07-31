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

## Safe Token Distribution (Airdrop)

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

### Transfer File Standard

The airdrop script accepts both `.json` and `.csv` file extensions with the following format

```json
[
  {
    "amount": "0.001",
    "tokenAddress": "0x4dbcdf9b62e891a7cec5a2568c3f4faf9e8abe2b",
    "receiver": "0x100000000000000000000000000000000000000"
  },
  {
    "amount": "0.002",
    "tokenAddress": "0x4dbcdf9b62e891a7cec5a2568c3f4faf9e8abe2b",
    "receiver": "0x2000000000000000000000000000000000000000"
  }
]
```

```csv
receiver,amount,token_address
0x90d26c3805030a05c7fdd89326a4a2a99cbade31,3.14159,0x6810e776880C02933D47DB1b9fc05908e5386b96
0x399c7819840329e2b73449d6afcf7f4fd71399b2,2.5,0x6810e776880C02933D47DB1b9fc05908e5386b96
0x274df99cf90c55f18f079f482750d03209b02f92,2,0x6810e776880C02933D47DB1b9fc05908e5386b96
```

Note that additional columns may beincluded in the CSV or JSON, but the above shown _must_ be available.

Selecting yes yields a link to the Gnosis Safe interface where the transaction can be signed and executed.

To do a "verification" run simply add the argument `--verify` and observe the difference in the last two lines of the logs emitted.

Note that, the gas costs for such transactions can vary based on the tokens you are transfering (since each token could potentially implement their transfer's differently).
