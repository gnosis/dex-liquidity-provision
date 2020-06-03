## Script Usage:

## Disclaimer:

Use at your own risk!

### Prerequisites

The scripts require the following software installed: [git](https://git-scm.com/), [yarn](https://yarnpkg.com/) and [node](https://nodejs.org/en/).


Install needed dependencies and build needed artifact:
```
yarn install
yarn builD
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
npx truffle exec scripts/complete_liquidity_provision.js --baseTokenId=1 --quoteTokenId=4 --lowestLimit=150 --highestLimit=200 --currentPrice=175 --masterSafe=$MASTER_SAFE --depositBaseToken=0.1 --depositQuoteToken=10 --numBrackets=10 --network=$NETWORK_NAME
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
npx truffle exec scripts/deploy_safes.js --masterSafe=$MASTER_SAFE --numSafes=20 --network=$NETWORK_NAME
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

Funds can be withdrawn using the scripts `request_withdraw.js` and `claim_withdraw.js`.

To this end, you must specify the brackets you want to withdraw from with `--brackets` and the tokens to be withdrawn using either `--tokens` (which takes a list of addresses) or `--tokenIds` (which takes a list of token IDs).
To make sure that the transaction does not need more gas than what fits in a block, the amount of tokens times the amount of brackets should indicatively be smaller than 40.

First, a withdraw request must be created for each bracket and token.
The following command request withdrawing of all DAI and WETH (token ID 7 and 1 respectively) for the brackets at addresses `0x0000000000000000000000000000000000000001` and `0x0000000000000000000000000000000000000002`:

```js
npx truffle exec scripts/request_withdraw.js --masterSafe=$MASTER_SAFE --brackets=0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002 --tokenIds=1,7 --network=$NETWORK_NAME
```

See [documenting brackets](#documenting-brackets) for how to retrieve the addresses of the brackets you created.
This command can be used to halt all tradings involving these brackets and tokens: Even if orders are still up, no trading will be possible starting from the next batch after the corresponding transaction has been confirmed.
No funds will have moved yet, but a withdraw request will have been registered on the exchange.

The next step transfers the funds from the exchange to the master Safe.
Internally, it composes two steps together: withdrawing funds from the exchange to each brackets, and then transferring funds from the brackets to master.
The parameters of the call are the same as before, the only change is the name of the script to be executed:

```js
npx truffle exec scripts/claim_withdraw.js --masterSafe=$MASTER_SAFE --brackets=0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002 --tokenIds=1,7 --network=$NETWORK_NAME
```

These scripts should be executed in the right order.
The script `claim_withdraw.js` will not withdraw any funds if run before requesting a withdrawal.
Running `request_withdraw.js` twice would cause all funds to be sent to the brackets instead of to the master Safe.
In this scenario, you can use the script `transfer_funds_to_master.js` with the same parameters to recover the funds from the brackets:

```js
npx truffle exec scripts/transfer_funds_to_master.js --masterSafe=$MASTER_SAFE --brackets=0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002 --tokenIds=1,7 --network=$NETWORK_NAME
```

For a more fine-grained management of the amounts to be withdrawn, withdrawal files can be used instead of `--brackets`, `--tokens`, and `--tokenIds` in all the scripts of this section.
All desired withdrawals should be specified in a JSON file with the following format:

```
[
    {
        "amount": "100000000000000000",
        "tokenAddress": "0xc778417e063141139fce010982780140aa0cd5ab",
        "bracketAddress": "0xfA4a18c2218945bC018BF94D093BCa66c88D3c40"
    },
    ...
]
```

See `examples/exampleDepositList.json` for a concrete example.

### Documenting brackets

In order to document the brackets deployed form a specific MASTER_SAFE, one can run the following script:

```js
npx truffle exec scripts/get_deployed_brackets.js --masterSafe=$MASTER_SAFE --network=$NETWORK_NAME
```

This command will print the brackets comma separated and it will put them into csv file. In order to copy the csv file's content into a google spread sheet, you can just copy the text within the csv file and paste it into the spread sheet. Then, in google sheet use the paste option "split text into columns" and use the ',' as separator.

### Confirming multisig-transactions on gnosis-safe with Metamask

The gas limit for the transactions going through the gnosis-safe interface can not yet be correctly estimated. Hence, the proposed gas limits are very high. Usually, for a liquidity deployment with 20 brackets, not more than 6m gas is consumed.
