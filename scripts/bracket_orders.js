const { fetchTokenInfoFromExchange, getExchange, getSafe, buildOrders } = require("./utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils")
const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { proceedAnyways, promptUser } = require("./utils/user_interface_helpers")
const { DEFAULT_ORDER_EXPIRY } = require("./utils/constants")

const { default_yargs, checkBracketsForDuplicate } = require("./utils/default_yargs")
const argv = default_yargs
  .option("baseTokenId", {
    type: "int",
    describe: "Base Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("quoteTokenId", {
    type: "int",
    describe: "Quote Token for which to open orders (i.e. DAI)",
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
  .option("expiry", {
    type: "int",
    describe: "Maximum auction batch for which these orders are valid",
    default: DEFAULT_ORDER_EXPIRY,
  })
  .check(checkBracketsForDuplicate).argv

module.exports = async (callback) => {
  try {
    const masterSafePromise = getSafe(argv.masterSafe)
    const exchange = await getExchange()

    // check price against external price API
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [argv.baseTokenId, argv.quoteTokenId])
    const baseTokenData = await tokenInfoPromises[argv.baseTokenId]
    const quoteTokenData = await tokenInfoPromises[argv.quoteTokenId]
    const priceCheck = await isPriceReasonable(baseTokenData, quoteTokenData, argv.currentPrice)
    const boundCheck = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)

    if (priceCheck || (await proceedAnyways("Price check failed!"))) {
      if (boundCheck || (await proceedAnyways("Bound check failed!"))) {
        console.log("Preparing order transaction data")
        const transaction = await buildOrders(
          argv.masterSafe,
          argv.brackets,
          argv.baseTokenId,
          argv.quoteTokenId,
          argv.lowestLimit,
          argv.highestLimit,
          true,
          argv.expiry
        )

        const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
        if (answer === "y" || answer.toLowerCase() === "yes") {
          await signAndSend(await masterSafePromise, transaction, argv.network)
        }
      }
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
