const { getExchange } = require("../utils/trading_strategy_helpers")(web3, artifacts)
const { SynthetixJs } = require("synthetix-js")
const { calculateBuyAndSellAmountsFromPrice, fetchTokenInfoFromExchange } = require("../utils/trading_strategy_helpers")(
  web3,
  artifacts
)

const sUSDAddress = {
  mainnet: "0xAe38b81459d74A8C16eAa968c792207603D84480",
  rinkeby: "0x1b642a124CDFa1E5835276A6ddAA6CFC4B35d52c",
}

const sETHAddress = {
  mainnet: "0xD0DC005d31C2979CC0d38718e23c82D1A50004C0",
  rinkeby: "0x0647b2C7a2a818276154b0fC79557F512B165bc1",
}

module.exports = async callback => {
  try {
    const snxjs = new SynthetixJs({ networkId: await web3.eth.net.getId() })
    const exchange = await getExchange(web3)
    const defaultAccount = (await web3.eth.getAccounts())[0]

    // Both of these hardcoded tokens are assumed to have 18 decimal places.
    // We "trust" that this will always be the case although it seems
    // that synthetix reserves the authority to upgrade their token
    // This could mean issuing a new one with a different number of decimals.
    const sETHKey = await snxjs.sETH.currencyKey()
    const sUSDKey = await snxjs.sUSD.currencyKey()

    // Fetch token IDs and other relevant token information for order placement.
    const referenceTokenId = (await exchange.tokenAddressToIdMap.call(sUSDAddress[process.env.NETWORK_NAME])).toNumber()
    const etherTokenId = (await exchange.tokenAddressToIdMap.call(sETHAddress[process.env.NETWORK_NAME])).toNumber()

    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [referenceTokenId, etherTokenId])
    const stableToken = await tokenInfoPromises[referenceTokenId]
    const targetToken = await tokenInfoPromises[etherTokenId]

    const buyTokens = [etherTokenId, referenceTokenId]
    const sellTokens = [referenceTokenId, etherTokenId]

    // Compute Rates and Fees based on price of sETH.
    // Note that sUSD always has a price of 1 within synthetix protocol.
    const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETHKey)
    const formatedRate = snxjs.utils.formatEther(exchangeRate)
    console.log("sETH Price", snxjs.utils.formatEther(exchangeRate))
    
    // Using synthetix's fees, and formatting their return values with their tools, plus parseFloat.
    const sETHTosUSDFee = parseFloat(
      snxjs.utils.formatEther(
        await snxjs.Exchanger.feeRateForExchange(sETHKey, sUSDKey)
      )
    )
    const sUSDTosETHFee = parseFloat(
      snxjs.utils.formatEther(
        await snxjs.Exchanger.feeRateForExchange(sUSDKey, sETHKey)
      )
    )

    // Compute buy-sell amounts based on unlimited orders with rates from above.
    const [lowerBuyAmount, lowerSellAmount] = calculateBuyAndSellAmountsFromPrice(
      formatedRate * (1 - sUSDTosETHFee),
      stableToken,
      targetToken
    )

    const [upperSellAmount, upperBuyAmount] = calculateBuyAndSellAmountsFromPrice(
      formatedRate * (1 + sETHTosUSDFee),
      stableToken,
      targetToken
    )
    const buyAmounts = [lowerBuyAmount, upperBuyAmount]
    const sellAmounts = [lowerSellAmount, upperSellAmount]

    // Fetch auction index and declare validity interval for orders.
    // Note that order validity interval is inclusive on both sides.
    const batch_index = (await exchange.getCurrentBatchId.call()).toNumber()
    const validFroms = Array(2).fill(batch_index)
    const validTos = Array(2).fill(batch_index)

    await exchange.placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts, {
      from: defaultAccount,
    })
    callback()
  } catch (error) {
    callback(error)
  }
}
