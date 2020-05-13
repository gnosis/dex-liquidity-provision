## Script Usage:

## Disclaimer:

Use at your own risk!

### Prerequisites

The scripts require the following software installed: [git](https://git-scm.com/), [yarn](https://yarnpkg.com/) and [node with version 10](https://nodejs.org/en/blog/release/v10.18.0/).

The Gnosis Protocol contracts must be compiled and the deployment addresses must be injected into built contract-artifacts.
To do so, run:

```
yarn global add npx
yarn compile
yarn run networks-inject
```

Create a gnosis-safe wallet [here-mainnet](https://gnosis-safe.io) or [here-rinkeby](https://rinkeby.gnosis-safe.io). This wallet will be called your Master Safe in the following. It is used to bundle the transactions and setup the bracket-traders.

### Setup env variables for the deployment process:

This Master Safe must have an additional owner (referred to as the "Proposer" account) with a private key exported to this project via the PK environment variable.
The following scripts will use this account to propose transactions to the interface and to deploy brackets.

Setup the following env variables for the deployment process:

```
 export PK=<private key of proposer account>
export GAS_PRICE_GWEI=<look up the suggestion from ethgasstation.info>
export NETWORK_NAME=<network>
export MASTER_SAFE=<master safe>
```

### Deploy the bracket-strategy:

In order to deploy new bracket-trader contracts, place orders on behalf of the newly mined contracts and fund their accounts on the exchange, one only has to run the `complete_liquidity_provision` script.
It will send one ethereum transaction and send two transactions request to the gnosis-safe interface.

The ethereum transaction will create the bracket-traders. For this transaction the provided private key will be used to pay for the gas.
The first request of the script will generate orders on behalf of the bracket-traders.
Please sign this transaction in the gnosis-safe interface and double check the order prices are as expected before signing the next - for example in [telegram-mainnet](https://t.me/gnosis_protocol) or [telegram-rinkeby](https://t.me/gnosis_protocol_dev) channels.

Another party can also verify the transactions that are to be signed correspond to a valid configuration by running the script with the `--verify` parameter and the same arguments as the original strategy (the safe flee has to be provided via `--brackets`).

The second request generates a transaction funding the bracket-traders' accounts on the exchange.
Making the requests to the gnosis-interfaces does not cost any gas. However, signing and executing the transactions in the gnosis-safe interface will incur gas costs.

Here is an example script invocation:

```js
npx truffle exec scripts/complete_liquidity_provision.js --baseTokenId=1 --quoteTokenId=4 --lowestLimit=150 --highestLimit=200 --currentPrice=175 --masterSafe=$MASTER_SAFE --depositBaseToken=0.1 --depositQuoteToken=10 --fleetSize=10 --network=$NETWORK_NAME
```

The prices must be specified in terms of 1 base token = x quote tokens.

This example deploys a liquidity strategy with 20 brackets between the prices 150-200 on the pair WETH-USDC.
In this script the baseToken is 1, which happens to be WETH, and the quoteToken is 4, which happens to be USDC.
The token ids of the exchange contract can be read from Etherscan info in the 'Contract/Read Contract' tab, e.g. [here for mainnet](https://etherscan.io/address/0x6f400810b62df8e13fded51be75ff5393eaa841f)

The fleet size should be smaller than or equal to 20, in order to ensure that the transactions can be sent via MetaMask - otherwise, it can happen that the payload is too high for Metamask.

Please document the displayed bracket-trader addresses. They are required for future withdrawals.
They can also be retrieved from the created transactions. However, since this is a manual process, it is quite cumbersome to extract them right now.

Instead of doing all the steps with one script, the different steps can also be done individually, as explained in the next section.

### Deploy safes

Requires that Master Safe has already been deployed.

An example of the usage would be:

```js
npx truffle exec scripts/deploy_safes.js --masterSafe=$MASTER_SAFE --fleetSize=20 --network=$NETWORK_NAME
```

### Place Orders

Requires that Master and bracket-traders are already deployed.

An example of the usage would be:

```js
npx truffle exec scripts/bracket_orders.js --baseTokenId=1 --quoteTokenID=7 --currentPrice=270 --lowestLimit=240 --highestLimit=300 --masterSafe=$MASTER_SAFE --brackets=0xb947de73ADe9aBC6D57eb34B2CC2efd41f646636,0xfA4a18c2218945bC018BF94D093BCa66c88D3c40 --network=$NETWORK_NAME
```

### Transfer-Approve-Deposit

For this script, a deposit file like the one available in `./examples/exampleDepositList.json`, needs to be created with the correct funding amounts of the brackets and their correct address.

Then the script can be used like that:

```js
npx truffle exec scripts/transfer_approve_deposit.js --masterSafe=$MASTER_SAFE --depositFile="./examples/exampleDepositList.json" --network=$NETWORK_NAME
```

### Withdrawing

To withdraw funds from the bracket traders, all withdrawals have to be specified in a file with the following format:

```
    {
        "amount": "100000000000000000",
        "tokenAddress": "0xc778417e063141139fce010982780140aa0cd5ab",
        "bracketAddress": "0xfA4a18c2218945bC018BF94D093BCa66c88D3c40"
    }
]
```

If you have forgotten the addresses of your brackets, then you should read in the next section how to retrieve them.

The script can automatically determine the amount, instead of having to specify it on the file.
This is achieved by adding the flag `--allTokens` to the withraw command. This is possible in any of the following commands.

Withdrawing is a two-step process: first, withdrawals must be requested on the exchange; then the withdrawals can be executed, and at the same time the funds can be sent back to the master Safe.

```js
npx truffle exec scripts/withdraw.js --requestWithdraw --masterSafe=$MASTER_SAFE --withdrawals="./examples/exampleDepositList.json" --network=$NETWORK_NAME
```

```js
npx truffle exec scripts/withdraw.js --withdraw --transferFundsToMaster --masterSafe=$MASTER_SAFE --withdrawals="./data/depositList.json" --network=$NETWORK_NAME
```

The latter instruction can be split into two independent units, if needed: withdrawing from the exchange to the bracket and transferring funds from the bracket to the master Safe.

```js
npx truffle exec scripts/withdraw.js --withdraw --masterSafe=$MASTER_SAFE --withdrawalsFromDepositFile="./data/depositList.json" --network=$NETWORK_NAME
```

```js
npx truffle exec scripts/withdraw.js --transferFundsToMaster --masterSafe=$MASTER_SAFE --withdrawalsFromDepositFile="./data/depositList.json" --network=$NETWORK_NAME
```

### Documenting brackets

In order to document the brackets deployed form a specific MASTER_SAFE, one can run the following script:

```js
npx truffle exec scripts/get_deployed_brackets.js --masterSafe=$MASTER_SAFE --network=$NETWORK_NAME
```

This command will print the brackets comma separated and it will put them into csv file. In order to copy the csv file's content into a google spread sheet, you can just copy the text within the csv file and paste it into the spread sheet. Then, in google sheet use the paste option "split text into columns" and use the ',' as separator.

### Confirming multisig-transactions on gnosis-safe with Metamask

The gas limit for the transactions going through the gnosis-safe interface can not yet be correctly estimated. Hence, the proposed gas limits are very high. Usually, for a liquidity deployment with 20 brackets, not more than 6m gas is consumed.
