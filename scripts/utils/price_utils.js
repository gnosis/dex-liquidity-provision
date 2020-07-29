const assert = require("assert")
const axios = require("axios")
const BN = require("bn.js")

const { decodeOrders, getUnitPrice } = require("@gnosis.pm/dex-contracts")
const { Fraction } = require("@gnosis.pm/dex-contracts")

const { toErc20Units } = require("./printing_tools")

/**
 * @typedef {import('../typedef.js').TokenObject} TokenObject
 * @typedef {import('../typedef.js').PriceFeedSlice} PriceFeedSlice
 */

const checkCorrectnessOfDeposits = async (
  currentPrice,
  bracketAddress,
  exchange,
  quoteToken,
  baseToken,
  depositQuoteTokenPerBracket,
  depositBaseTokenPerBracket
) => {
  // all prices are of the form: 1 base token = "price" quote tokens
  const bracketExchangeBalanceQuoteToken = (await exchange.getBalance(bracketAddress, quoteToken.address)).toString()
  const bracketExchangeBalanceBaseToken = (await exchange.getBalance(bracketAddress, baseToken.address)).toString()
  const baseTokenId = await exchange.tokenAddressToIdMap.call(baseToken.address)
  const quoteTokenId = await exchange.tokenAddressToIdMap.call(quoteToken.address)

  const auctionElements = decodeOrders(await exchange.getEncodedUserOrders.call(bracketAddress))
  const bracketOrders = auctionElements.filter((order) => order.user.toLowerCase() === bracketAddress.toLowerCase())
  assert.equal(bracketOrders.length, 2)

  const currentUnitPrice = getUnitPrice(currentPrice, await baseToken.decimals(), await quoteToken.decimals())

  const buyBaseTokenOrders = bracketOrders.filter((order) => order.buyToken == baseTokenId)
  assert.equal(buyBaseTokenOrders.length, 1)
  const buyBaseTokenOrder = buyBaseTokenOrders[0]
  assert.equal(buyBaseTokenOrder.sellToken, quoteTokenId)
  // price of order is in terms of base tokens per quote token, the inverse is needed
  const priceBuyingBaseToken = new Fraction(buyBaseTokenOrder.priceNumerator, buyBaseTokenOrder.priceDenominator).inverted()

  const sellBaseTokenOrders = bracketOrders.filter((order) => order.sellToken == baseTokenId)
  assert.equal(sellBaseTokenOrders.length, 1)
  const sellBaseTokenOrder = sellBaseTokenOrders[0]
  assert.equal(sellBaseTokenOrder.buyToken, quoteTokenId)
  const priceSellingBaseToken = new Fraction(sellBaseTokenOrder.priceNumerator, sellBaseTokenOrder.priceDenominator)

  assert(priceBuyingBaseToken.lt(priceSellingBaseToken))

  if (priceSellingBaseToken.lt(currentUnitPrice)) {
    assert.equal(bracketExchangeBalanceBaseToken, "0")
    assert.equal(bracketExchangeBalanceQuoteToken, depositQuoteTokenPerBracket.toString())
  } else if (priceBuyingBaseToken.gt(currentUnitPrice)) {
    assert.equal(bracketExchangeBalanceBaseToken, depositBaseTokenPerBracket.toString())
    assert.equal(bracketExchangeBalanceQuoteToken, "0")
  } else {
    assert(
      checkFundingInTheMiddleBracket(
        bracketExchangeBalanceQuoteToken,
        bracketExchangeBalanceBaseToken,
        depositQuoteTokenPerBracket,
        depositBaseTokenPerBracket
      )
    )
  }
}

const checkFundingInTheMiddleBracket = function (
  bracketExchangeBalanceQuoteToken,
  bracketExchangeBalanceBaseToken,
  depositQuoteTokenPerBracket,
  depositBaseTokenPerBracket
) {
  // For the middle bracket the funding can go in either bracket
  // it depends on closer distance from the currentPrice to the limit prices fo the bracket-traders
  return (
    (bracketExchangeBalanceQuoteToken === "0" && bracketExchangeBalanceBaseToken === depositBaseTokenPerBracket.toString()) ||
    (bracketExchangeBalanceBaseToken === "0" && bracketExchangeBalanceQuoteToken === depositQuoteTokenPerBracket.toString())
  )
}

const areBoundsReasonable = function (currentPrice, lowestLimit, highestLimit) {
  const boundsCloseTocurrentPrice = currentPrice / 1.5 < lowestLimit && highestLimit < currentPrice * 1.5
  if (!boundsCloseTocurrentPrice) {
    console.log("Please double check your bounds. They seem to be unreasonable")
  }
  const currentPriceWithinBounds = currentPrice > lowestLimit && highestLimit > currentPrice
  if (!currentPriceWithinBounds) {
    console.log("Please double check your bounds. Current price is not within the bounds")
  }
  return currentPriceWithinBounds && boundsCloseTocurrentPrice
}

// returns undefined if the price was not available
const getDexagPrice = async function (tokenBought, tokenSold, globalPriceStorage = null) {
  if (globalPriceStorage !== null && tokenBought + "-" + tokenSold in globalPriceStorage) {
    return globalPriceStorage[tokenBought + "-" + tokenSold]
  }
  if (globalPriceStorage !== null && tokenSold + "-" + tokenBought in globalPriceStorage) {
    return 1.0 / globalPriceStorage[tokenSold + "-" + tokenBought]
  }
  // dex.ag considers WETH to be the same as ETH and fails when using WETH as token
  tokenBought = tokenBought == "WETH" ? "ETH" : tokenBought
  tokenSold = tokenSold == "WETH" ? "ETH" : tokenSold
  // see https://docs.dex.ag/ for API documentation
  const url = "https://api-v2.dex.ag/price?from=" + tokenSold + "&to=" + tokenBought + "&fromAmount=1&dex=ag"
  let price
  // try to get price 3 times
  for (let i = 0; i < 3; i++) {
    try {
      const requestResult = await axios.get(url)
      price = requestResult.data.price
      break
    } catch (error) {
      if (i == 2) {
        console.log("Warning: unable to retrieve price information on dex.ag. The server returns:")
        console.log(">", error.response.data.error)
      }
    }
  }
  if (globalPriceStorage !== null) {
    globalPriceStorage[tokenBought + "-" + tokenSold] = price
  }
  return price
}

/**
 * Returns the price on the 1inh aggregator for a given pair.
 * Optionally, it first checks whether the price is present in an input cache and
 * in case returns that price without any network request.
 *
 * Note that the output price is not very accurate, especially for tokens with
 * very high value and very little liquidity. This is due to the fact that 1inch
 * returns a sell and a by price for a given amount
 *
 * See https://1inch.exchange/#/api for API documentation.
 *
 * @param {TokenObject} baseToken base token for the price
 * @param {TokenObject} quoteToken quote token for the price
 * @param {object} [globalPriceStorage=null] object linking token pairs to prices
 * @returns {PriceFeedSlice} price information (if available, undefined otherwise) and ancillary data
 */
const getOneinchPrice = async function (baseToken, quoteToken, globalPriceStorage = null) {
  // TODO: escape `-` in token symbols
  if (globalPriceStorage !== null && baseToken.symbol + "-" + quoteToken.symbol in globalPriceStorage) {
    return globalPriceStorage[baseToken.symbol + "-" + quoteToken.symbol]
  }
  if (globalPriceStorage !== null && quoteToken.symbol + "-" + baseToken.symbol in globalPriceStorage) {
    const inverseSlice = globalPriceStorage[quoteToken.symbol + "-" + baseToken.symbol]
    const priceFeedSlice = {
      price: 1.0 / inverseSlice.price,
      source: inverseSlice.source,
    }
    return priceFeedSlice
  }
  // TODO: this check is here because apparently the type TokenObject could be BN, according
  // to '../typedef.js'. I think this is never the case however, so this should be verified
  // and changed accordingly. There are instances of the code where + and - are used with the
  // decimals.
  // It also confirms that .decimals is defined
  if ((typeof quoteToken.decimals !== "number") | (typeof baseToken.decimals !== "number")) {
    throw new Error("Invalid token input for retrieving price from aggregator.")
  }
  const quoteTokenAmount = toErc20Units("1", quoteToken.decimals)
  const url =
    "https://api.1inch.exchange/v1.1/quote?fromTokenSymbol=" +
    quoteToken.symbol +
    "&toTokenSymbol=" +
    baseToken.symbol +
    "&amount=" +
    quoteTokenAmount.toString()
  let price
  // try to get price 3 times
  for (let i = 0; i < 3; i++) {
    try {
      const requestResult = await axios.get(url)
      const amountReceived = parseInt(requestResult.data.toTokenAmount)
      const amountUsed = parseInt(requestResult.data.fromTokenAmount)
      const decimalCorrection = 10 ** (baseToken.decimals - quoteToken.decimals)
      price = amountReceived / amountUsed / decimalCorrection
      break
    } catch (error) {
      if (i == 2) {
        console.log("Warning: unable to retrieve price information on 1inch. The server returns:")
        console.log(">", error.response.data.message)
      }
    }
  }
  const priceFeedSlice = {
    price,
    source: "1inch",
  }
  if (globalPriceStorage !== null) {
    globalPriceStorage[baseToken + "-" + quoteToken] = priceFeedSlice
  }
  return priceFeedSlice
}

const isPriceReasonable = async (baseToken, quoteToken, price, acceptedPriceDeviationInPercentage = 2) => {
  const onlinePriceSlice = await getOneinchPrice(baseToken, quoteToken)
  const onlinePrice = onlinePriceSlice.price
  if (onlinePrice === undefined) {
    console.log("Warning: could not perform price check against price aggregator.")
    return false
  } else if (Math.abs(onlinePrice - price) / price >= acceptedPriceDeviationInPercentage / 100) {
    console.log(
      `Warning: the chosen price differs by more than ${acceptedPriceDeviationInPercentage} percent from the price found on ${onlinePriceSlice.source}.`
    )
    console.log(`    chosen price: ${price} ${baseToken.symbol} bought for 1 ${quoteToken.symbol}`)
    console.log(`    ${onlinePriceSlice.source} price: ${onlinePrice} ${baseToken.symbol} bought for 1 ${quoteToken.symbol}`)
    return false
  }
  return true
}

const checkNoProfitableOffer = async (order, tokenInfo, globalPriceStorage = null) => {
  const currentMarketPriceSlice = await getOneinchPrice(
    await tokenInfo[order.buyToken],
    await tokenInfo[order.sellToken],
    globalPriceStorage
  )
  const currentMarketPrice = currentMarketPriceSlice.price

  if (isNaN(currentMarketPrice)) {
    return true
  }

  // checks whether the order amount is negligible
  if ((await orderSellValueInUSD(order, tokenInfo, globalPriceStorage)).lt(new BN("1"))) {
    return true
  }

  const marketPrice = getUnitPrice(
    parseFloat(currentMarketPrice),
    (await tokenInfo[order.sellToken]).decimals,
    (await tokenInfo[order.buyToken]).decimals
  )
  const orderPrice = new Fraction(order.priceNumerator, order.priceDenominator)

  return marketPrice.lt(orderPrice)
}

const orderSellValueInUSD = async (order, tokenInfo, globalPriceStorage = null) => {
  const currentMarketPriceSlice = await getOneinchPrice(
    await tokenInfo[order.sellToken],
    { symbol: "USDC", decimals: 6 },
    globalPriceStorage
  )
  const currentMarketPrice = currentMarketPriceSlice.price

  return Fraction.fromNumber(parseFloat(currentMarketPrice))
    .mul(new Fraction(order.sellTokenBalance, new BN(10).pow(new BN((await tokenInfo[order.sellToken]).decimals))))
    .toBN()
}

const amountUSDValue = async function (amount, tokenInfo, globalPriceStorage = null) {
  const currentMarketPriceSlice = await getOneinchPrice(tokenInfo, { symbol: "USDC", decimals: 6 }, globalPriceStorage)
  const currentMarketPrice = currentMarketPriceSlice.price

  return Fraction.fromNumber(parseFloat(currentMarketPrice))
    .mul(new Fraction(new BN(amount), new BN(10).pow(new BN(tokenInfo.decimals))))
    .toBN()
}

module.exports = {
  amountUSDValue,
  areBoundsReasonable,
  checkCorrectnessOfDeposits,
  checkNoProfitableOffer,
  isPriceReasonable,
  getDexagPrice,
  getOneinchPrice,
  orderSellValueInUSD,
}
