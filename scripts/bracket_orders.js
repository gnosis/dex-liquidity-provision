const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const { buildOrders } = require("./utils/trading_strategy_helpers")
const { isPriceReasonable } = require("./utils/price-utils.js")
const { signAndSend, promptUser } = require("./utils/sign_and_send")

const argv = require("yargs")
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
  })
  .option("stableToken", {
    describe: "Stable Token for which to open orders (i.e. DAI)",
  })
  .option("targetPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning all brackets",
  })
  .option("brackets", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of.",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("priceRange", {
    type: "float",
    describe: "Percentage above and below the target price for which orders are to be placed",
    default: 20,
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
  .demand(["targetToken", "stableToken", "targetPrice", "masterSafe", "brackets"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    await BatchExchange.setProvider(web3.currentProvider)
    await BatchExchange.setNetwork(web3.network_id)
    const exchange = await BatchExchange.deployed()
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    // check price against dex.ag's API
    const targetTokenId = argv.targetToken
    const stableTokenId = argv.stableToken
    const priceCheck = await isPriceReasonable(exchange, targetTokenId, stableTokenId, argv.targetPrice, artifacts)
    let proceedAnyways = false
    if (!priceCheck) {
      const answer = await promptUser("Continue anyway? [yN] ")
      if (answer != "y" && answer.toLowerCase() != "yes") {
        proceedAnyways = true
      }
    }

    if (priceCheck || proceedAnyways) {
      console.log("Preparing order transaction data")
      const transaction = await buildOrders(
        argv.masterSafe,
        argv.brackets,
        argv.targetToken,
        argv.stableToken,
        argv.targetPrice,
        web3,
        artifacts,
        true,
        argv.priceRange,
        argv.validFrom,
        argv.expiry
      )

      const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
      if (answer == "y" || answer.toLowerCase() == "yes") {
        await signAndSend(masterSafe, transaction, web3, argv.network)
      }
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
