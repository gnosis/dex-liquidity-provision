const BatchExchange = artifacts.require("BatchExchange")
const BN = require("bn.js")
const { SynthetixJs } = require("synthetix-js")
const { calculateBuyAndSellAmountsFromPrice } = require("../utils/trading_strategy_helpers")

const { sendTxAndGetReturnValue } = require("../test/utilities.js")

const argv = require("yargs")
  .option("spread", {
    type: "float",
    describe: "Percentage increase required for trade (fees not accounted)",
    default: 0.2,
  })
  .option("sellAmount", {
    type: "int",
    describe: "Maximum sell amount in sUSD (sETH amount will be determined from price).",
    default: 1000,
  })
  .version(false).argv

module.exports = async callback => {
  try {
    const snxjs = new SynthetixJs({ network: argv.network })

    const batchExchange = await BatchExchange.deployed()
    const account = (await web3.eth.getAccounts())[0]

    // Both of these hardcoded tokens have 18 decimal places.
    // We "trust" that this will always be the case
    // Although it seems that synthetix has the authority to upgade their token
    // which could mean deploying a new one with a different number of decimal places.
    const sETHKey = await snxjs.sETH.currencyKey()
    const sUSDKey = await snxjs.sUSD.currencyKey()

    const sETHAddress = await snxjs.Synthetix.synths(sETHKey)
    const sUSDAddress = await snxjs.Synthetix.synths(sUSDKey)

    const referenceTokenId = (await batchExchange.tokenAddressToIdMap.call(sUSDAddress)).toNumber()
    const etherTokenId = (await batchExchange.tokenAddressToIdMap.call(sETHAddress)).toNumber()

    const tokenInfoPromises = fetchTokenInfoFromExchange(batchExchange, [referenceTokenId, etherTokenId])

    const stableToken = await tokenInfoPromises[referenceTokenId]
    const targetToken = await tokenInfoPromises[etherTokenId]

    // Note that sUSD is always 1 with synthetix
    const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETHKey)
    console.log("Current price of sETH", exchangeRate)

    const batch_index = (await batchExchange.getCurrentBatchId.call()).toNumber()

    const buyTokens = [etherTokenId, referenceTokenId]
    const sellTokens = [referenceTokenId, etherTokenId]

    const [upperSellAmount, upperBuyAmount] = calculateBuyAndSellAmountsFromPrice(
      exchangeRate * (1 + argv.spread),
      stableToken,
      targetToken
    )
    const [lowerBuyAmount, lowerSellAmount] = calculateBuyAndSellAmountsFromPrice(
      exchangeRate * (1 - argv.spread),
      stableToken,
      targetToken
    )

    const buyAmounts = [lowerBuyAmount, upperBuyAmount]
    const sellAmounts = [lowerSellAmount, upperSellAmount]

    const validFroms = Array(2).fill(batch_index)
    const validTos = Array(2).fill(batch_index + 1)

    // TODO - use replaceOrder
    await sendTxAndGetReturnValue(
      batchExchange.placeValidFromOrders,
      buyTokens,
      sellTokens,
      validFroms,
      validTos,
      buyAmounts,
      sellAmounts,
      {
        from: account,
      }
    )

    callback()
  } catch (error) {
    callback(error)
  }
}
