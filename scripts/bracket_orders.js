const ERC20 = artifacts.require("ERC20Detailed")
const BN = require("bn.js")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const readline = require("readline")

const { sendTxAndGetReturnValue } = require("../../test/utilities.js")

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const promptUser = function(message) {
  return new Promise(resolve => rl.question(message, answer => resolve(answer)))
}

const fetchTokenInfo = async function(contract, tokenId) {
  console.log("Fetching token data from EVM")
  const tokenAddress = await contract.tokenIdToAddressMap(tokenId)
  const tokenInstance = await ERC20.at(tokenAddress)
  const tokenInfo = {
    id: tokenId,
    symbol: await tokenInstance.symbol.call(),
    decimals: (await tokenInstance.decimals.call()).toNumber(),
  }
  tokenInfo
  console.log(`Found Token ${tokenInfo.symbol} at ID ${tokenInfo.id} with ${tokenInfo.decimals} decimals`)
  return tokenInfo
}

// const formatAmount = function(amount, token) {
//   return new BN(10).pow(new BN(token.decimals)).muln(amount)
// }

const argv = require("yargs")
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
  })
  .option("stableToken", {
    describe: "Trusted Stable Token for which to open orders (i.e. DAI)",
  })
  .option("targetPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("priceRange", {
    type: "float",
    describe: "Percentage above and below the target price for which orders are to be placed",
    default: 20,
  })
  .option("numBrackets", {
    type: "int",
    describe:
      "Number of, equally spaced, brackets (buy-sell orders) to be placed above and below the target price. If odd, extra bracket is placed above.",
    default: 19,
  })
  .option("validFrom", {
    type: "int",
    describe: "Number of batches (from current) until order become valid",
    default: 3,
  })
  .option("expiry", {
    type: "int",
    describe: "Maximum auction batch for which these orders are valid",
    default: 2 ** 32 - 1,
  })
  .demand(["targetToken", "stableToken", "targetPrice", "priceRange"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js Example usage \n   npx truffle exec scripts/stablex/place_spread_orders.js --tokens=2,3,4 --accountId 0 --spread 0.3 --validFrom 5"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    // const exchange = await BatchExchange.deployed()
    // const batch_index = (await instance.getCurrentBatchId.call()).toNumber()
    // const targetTokenData = await fetchTokenInfo(exchange, argv.targetToken)
    // const stableTokenData = await fetchTokenInfo(exchange, argv.stableToken)

    console.log("Preparing Order Data")

    // const validFroms = Array(buyTokens.length).fill(batch_index + argv.validFrom)
    // const validTos = Array(buyTokens.length).fill(argv.expiry)

    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      // Deploy the safes
      // Place the orders
      // Log the resulting transaction hash
      // Display option to cancel.
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
