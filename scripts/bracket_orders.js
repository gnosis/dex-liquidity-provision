const { fetchTokenInfoFromExchange, getExchange, getSafe, buildOrders } = require("./utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils.js")(web3, artifacts)
const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { proceedAnyways } = require("./utils/user_interface_helpers")

const argv = require("./utils/default_yargs")
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("stableToken", {
    type: "int",
    describe: "Stable Token for which to open orders (i.e. DAI)",
    demandOption: true,
  })
  .option("currentPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
    demandOption: true,
  })
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning all brackets",
    demandOption: true,
  })
  .option("brackets", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of",
    demandOption: true,
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("lowestLimit", {
    type: "float",
    describe: "Price for the bracket buying with the lowest price",
  })
  .option("highestLimit", {
    type: "float",
    describe: "Price for the bracket selling at the highest price",
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
  }).argv

module.exports = async (callback) => {
  try {
    const masterSafePromise = getSafe(argv.masterSafe)
    const exchange = await getExchange(web3)

    // check price against dex.ag's API
    const targetTokenId = argv.targetToken
    const stableTokenId = argv.stableToken
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [targetTokenId, stableTokenId])
    const targetTokenData = await tokenInfoPromises[targetTokenId]
    const stableTokenData = await tokenInfoPromises[stableTokenId]
    const priceCheck = await isPriceReasonable(targetTokenData, stableTokenData, argv.currentPrice)
    const boundCheck = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)

    if (priceCheck || (await proceedAnyways("Price check failed!"))) {
      if (boundCheck || (await proceedAnyways("Bound check failed!"))) {
        console.log("Preparing order transaction data")
        const transaction = await buildOrders(
          argv.masterSafe,
          argv.brackets,
          argv.targetToken,
          argv.stableToken,
          argv.lowestLimit,
          argv.highestLimit,
          true,
          argv.validFrom,
          argv.expiry
        )

        const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
        if (answer == "y" || answer.toLowerCase() == "yes") {
          await signAndSend(await masterSafePromise(), transaction, argv.network)
        }
      }
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
