const { getExchange } = require("../utils/trading_strategy_helpers")(web3, artifacts)
const { SynthetixJs } = require("synthetix-js")
const { calculateBuyAndSellAmountsFromPrice, fetchTokenInfoFromExchange } = require("../utils/trading_strategy_helpers")(web3, artifacts)

// TODO - put this somewhere more generic. Copied from dex-contracts
const sendTxAndGetReturnValue = async function (method, ...args) {
  const result = await method.call(...args)
  await method(...args)
  return result
}

// truffle uses network by name and SynthetixJS uses network by ID
const networkMap = {
  "mainnet": 1,
  "rinkeby": 4,
}

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
    const snxjs = new SynthetixJs({ networkId: networkMap[argv.network] })

    const exchange = await getExchange(web3)
    const account = (await web3.eth.getAccounts())[0]

    // Both of these hardcoded tokens have 18 decimal places.
    // We "trust" that this will always be the case
    // Although it seems that synthetix has the authority to upgade their token
    // which could mean deploying a new one with a different number of decimal places.
    const sETHKey = await snxjs.sETH.currencyKey()
    const sUSDKey = await snxjs.sUSD.currencyKey()

    const sETHAddress = await snxjs.Synthetix.synths(sETHKey)
    const sUSDAddress = await snxjs.Synthetix.synths(sUSDKey)
    console.log("sETH Address", sETHAddress)
    console.log("sUSD Address", sUSDAddress)
    const referenceTokenId = (await exchange.tokenAddressToIdMap.call(sUSDAddress)).toNumber()
    const etherTokenId = (await exchange.tokenAddressToIdMap.call(sETHAddress)).toNumber()

    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [referenceTokenId, etherTokenId])

    const stableToken = await tokenInfoPromises[referenceTokenId]
    const targetToken = await tokenInfoPromises[etherTokenId]

    // Note that sUSD is always 1 with synthetix
    const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETHKey)
    const formatedRate = snxjs.utils.formatEther(exchangeRate)
    console.log("sETH Price", snxjs.utils.formatEther(exchangeRate))


    const batch_index = (await exchange.getCurrentBatchId.call()).toNumber()

    const buyTokens = [etherTokenId, referenceTokenId]
    const sellTokens = [referenceTokenId, etherTokenId]

    const [upperSellAmount, upperBuyAmount] = calculateBuyAndSellAmountsFromPrice(
      formatedRate * (1 + argv.spread / 100),
      stableToken,
      targetToken
    )
    const [lowerBuyAmount, lowerSellAmount] = calculateBuyAndSellAmountsFromPrice(
      formatedRate * (1 - argv.spread / 100),
      stableToken,
      targetToken
    )

    const buyAmounts = [lowerBuyAmount, upperBuyAmount]
    const sellAmounts = [lowerSellAmount, upperSellAmount]

    const validFroms = Array(2).fill(batch_index)
    const validTos = Array(2).fill(batch_index + 1)
    
    // TODO - use replaceOrder if possible.
    await sendTxAndGetReturnValue(
      exchange.placeValidFromOrders,
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
