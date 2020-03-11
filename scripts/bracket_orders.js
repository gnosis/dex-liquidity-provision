const axios = require("axios")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const { buildOrders, fetchTokenInfo } = require("./utils/trading_strategy_helpers")
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

// returns undefined if the price was not available
const getDexagPrice = async function(tokenBought, tokenSold) {
  // dex.ag considers WETH to be the same as ETH and fails when using WETH as token
  tokenBought = tokenBought == "WETH" ? "ETH" : tokenBought
  tokenSold = tokenSold == "WETH" ? "ETH" : tokenSold
  // see https://docs.dex.ag/ for API documentation
  const url = "https://api-v2.dex.ag/price?from=" + tokenSold + "&to=" + tokenBought + "&fromAmount=1&dex=ag"
  let price
  try {
    const requestResult = await axios.get(url)
    price = requestResult.data.price
  } catch (error) {
    console.log("Warning: unable to retrieve price information on dex.ag. The server returns:")
    console.log(">", error.response.data.error)
  }
  return price
}

const acceptedPriceDeviationInPercentage = 2
const isPriceReasonable = async function(exchange, targetTokenId, stableTokenId, price) {
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId], artifacts)
  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
  const dexagPrice = await getDexagPrice(targetToken.symbol, stableToken.symbol)
  // TODO add unit test checking whether getDexagPrice works as expected
  if (dexagPrice === undefined) {
    console.log("Warning: could not perform price check against dex.ag.")
    const answer = await promptUser("Continue anyway? [yN] ")
    if (answer != "y" && answer.toLowerCase() != "yes") {
      return false
    }
  } else if (Math.abs(dexagPrice - price) >= acceptedPriceDeviationInPercentage / 100) {
    console.log(
      "Warning: the chosen price differs by more than",
      acceptedPriceDeviationInPercentage,
      "percent from the price found on dex.ag."
    )
    console.log("         chosen price:", price, targetToken.symbol, "bought for 1", stableToken.symbol)
    console.log("         dex.ag price:", dexagPrice, targetToken.symbol, "bought for 1", stableToken.symbol)
    const answer = await promptUser("Continue anyway? [yN] ")
    if (answer != "y" && answer.toLowerCase() != "yes") {
      return false
    }
  }
  return true
}

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
    const priceIsOk = await isPriceReasonable(exchange, targetTokenId, stableTokenId, argv.targetPrice)

    if (priceIsOk) {
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
