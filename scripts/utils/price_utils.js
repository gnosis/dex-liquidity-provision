module.exports = function (web3 = web3, artifacts = artifacts) {
  const assert = require("assert")
  const axios = require("axios")
  const BN = require("bn.js")

  const exchangeUtils = require("@gnosis.pm/dex-contracts")
  const { Fraction } = require("@gnosis.pm/dex-contracts")

  const max128 = new BN(2).pow(new BN(128)).subn(1)

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

    const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders.call(bracketAddress))
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

  const isPriceReasonable = async (baseTokenData, quoteTokenData, price, acceptedPriceDeviationInPercentage = 2) => {
    const dexagPrice = await getDexagPrice(quoteTokenData.symbol, baseTokenData.symbol)
    if (dexagPrice === undefined) {
      console.log("Warning: could not perform price check against dex.ag.")
      return false
    } else if (Math.abs(dexagPrice - price) / price >= acceptedPriceDeviationInPercentage / 100) {
      console.log(
        "Warning: the chosen price differs by more than",
        acceptedPriceDeviationInPercentage,
        "percent from the price found on dex.ag."
      )
      console.log("         chosen price:", price, quoteTokenData.symbol, "bought for 1", baseTokenData.symbol)
      console.log("         dex.ag price:", dexagPrice, quoteTokenData.symbol, "bought for 1", baseTokenData.symbol)
      return false
    }
    return true
  }

  /**
   * Modifies the price to work with ERC20 units
   * @param {number} price amount of quote token in exchange for one base token
   * @param {integer} baseTokenDecimals number of decimals of the base token
   * @param {integer} quoteTokenDecimals number of decimals of the quote token
   * @return {Fraction} fraction representing the amount of units of quote tokens in exchange for one unit of base token
   */
  const getUnitPrice = function (price, baseTokenDecimals, quoteTokenDecimals) {
    return Fraction.fromNumber(price).mul(
      new Fraction(new BN(10).pow(new BN(quoteTokenDecimals)), new BN(10).pow(new BN(baseTokenDecimals)))
    )
  }

  /**
   * Computes the amount of output token units from their price and the amount of input token units
   * Note that the price is expressed in terms of tokens, while the amounts are in terms of token units
   * @param {number} price amount of quote token in exchange for one base token
   * @param {BN} baseTokenAmount amount of base token units that are exchanged at price
   * @param {integer} baseTokenDecimals number of decimals of the base token
   * @param {integer} quoteTokenDecimals number of decimals of the quote token
   * @return {BN} amount of output token units obtained
   */
  const getOutputAmountFromPrice = function (price, baseTokenAmount, baseTokenDecimals, quoteTokenDecimals) {
    const unitPriceFraction = getUnitPrice(price, baseTokenDecimals, quoteTokenDecimals)
    const quoteTokenAmountFraction = unitPriceFraction.mul(new Fraction(baseTokenAmount, 1))
    return quoteTokenAmountFraction.toBN()
  }

  /**
   * Computes the quote and base token amounts needed to set up an unlimited order in the exchange
   * @param {number} price amount of quote tokens in exchange for one base token
   * @param {integer} baseTokenDecimals number of decimals of the base token
   * @param {integer} quoteTokenDecimals number of decimals of the quote token
   * @return {BN[2]} amounts of quote token and base token for an unlimited order at the input price
   */
  const getUnlimitedOrderAmounts = function (price, baseTokenDecimals, quoteTokenDecimals) {
    let baseTokenAmount = max128.clone()
    let quoteTokenAmount = getOutputAmountFromPrice(price, baseTokenAmount, baseTokenDecimals, quoteTokenDecimals)
    if (quoteTokenAmount.gt(baseTokenAmount)) {
      quoteTokenAmount = max128.clone()
      baseTokenAmount = getOutputAmountFromPrice(1 / price, quoteTokenAmount, quoteTokenDecimals, baseTokenDecimals)
      assert(quoteTokenAmount.gte(baseTokenAmount), "Error: unable to create unlimited order")
    }
    return [baseTokenAmount, quoteTokenAmount]
  }

  const checkNoProfitableOffer = async (order, exchange, tokenInfo, globalPriceStorage = null) => {
    const currentMarketPrice = await getDexagPrice(
      (await tokenInfo[order.buyToken]).symbol,
      (await tokenInfo[order.sellToken]).symbol,
      globalPriceStorage
    )

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
    const currentMarketPrice = await getDexagPrice("USDC", (await tokenInfo[order.sellToken]).symbol, globalPriceStorage)

    return Fraction.fromNumber(parseFloat(currentMarketPrice))
      .mul(new Fraction(order.sellTokenBalance, new BN(10).pow(new BN((await tokenInfo[order.sellToken]).decimals))))
      .toBN()
  }

  return {
    isPriceReasonable,
    areBoundsReasonable,
    checkCorrectnessOfDeposits,
    getOutputAmountFromPrice,
    getUnlimitedOrderAmounts,
    getDexagPrice,
    checkNoProfitableOffer,
    max128,
  }
}
