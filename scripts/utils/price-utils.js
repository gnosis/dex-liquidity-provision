module.exports = function(web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const BN = require("bn.js")
  const precisionDecimals = 20
  const { toErc20Units, fromErc20Units } = require("./printing_tools")
  const exchangeUtils = require("@gnosis.pm/dex-contracts")
  const { Fraction } = require("@gnosis.pm/dex-contracts/src")

  const max128 = new BN(2).pow(new BN(128)).subn(1)

  const checkCorrectnessOfDeposits = async (
    currentPrice,
    bracketAddress,
    exchange,
    stableToken,
    targetToken,
    investmentStableTokenPerBracket,
    investmentTargetTokenPerBracket
  ) => {
    const bracketExchangeBalanceStableToken = (await exchange.getBalance(bracketAddress, stableToken.address)).toString()
    const bracketExchangeBalanceTargetToken = (await exchange.getBalance(bracketAddress, targetToken.address)).toString()
    const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders.call(bracketAddress))
    const bracketOrders = auctionElements.filter(order => order.user.toLowerCase() === bracketAddress.toLowerCase())
    assert.equal(bracketOrders.length, 2)

    const stableTokenId = await exchange.tokenAddressToIdMap.call(stableToken.address)
    const sellStableTokenOrders = bracketOrders.filter(order => order.sellToken == stableTokenId)
    assert.equal(sellStableTokenOrders.length, 1)
    const sellStableTokenOrder = sellStableTokenOrders[0]

    const targetTokenId = await exchange.tokenAddressToIdMap.call(targetToken.address)
    const sellTargetTokenOrders = bracketOrders.filter(order => order.sellToken == targetTokenId)
    assert.equal(sellTargetTokenOrders.length, 1)
    const sellTargetTokenOrder = sellTargetTokenOrders[0]

    // Check that tokens with a lower price than the target price are funded with stableTokens
    if (checkThatOrderPriceIsBelowTarget(currentPrice, sellStableTokenOrder)) {
      // checks whether price is in middle of bracket:
      if (checkThatOrderPriceIsBelowTarget(1 / currentPrice, sellTargetTokenOrder)) {
        assert.isTrue(
          checkFundingInTheMiddleBracket(
            bracketExchangeBalanceStableToken,
            bracketExchangeBalanceTargetToken,
            investmentStableTokenPerBracket,
            investmentTargetTokenPerBracket
          )
        )
      } else {
        assert.equal(bracketExchangeBalanceStableToken, investmentStableTokenPerBracket.toString())
      }
    } else {
      assert.equal(bracketExchangeBalanceStableToken, 0)
    }

    if (checkThatOrderPriceIsBelowTarget(1 / currentPrice, sellTargetTokenOrder)) {
      if (checkThatOrderPriceIsBelowTarget(currentPrice, sellStableTokenOrder)) {
        assert.isTrue(
          checkFundingInTheMiddleBracket(
            bracketExchangeBalanceStableToken,
            bracketExchangeBalanceTargetToken,
            investmentStableTokenPerBracket,
            investmentTargetTokenPerBracket
          )
        )
      } else {
        assert.equal(bracketExchangeBalanceTargetToken, investmentTargetTokenPerBracket.toString())
      }
    } else {
      assert.equal(bracketExchangeBalanceTargetToken, 0)
    }
  }

  const checkThatOrderPriceIsBelowTarget = function(currentPrice, order) {
    const multiplicator = 1000000000
    return new BN(currentPrice * multiplicator).mul(order.priceNumerator) > order.priceDenominator.mul(new BN(multiplicator))
  }

  const checkFundingInTheMiddleBracket = function(
    bracketExchangeBalanceStableToken,
    bracketExchangeBalanceTargetToken,
    investmentStableTokenPerBracket,
    investmentTargetTokenPerBracket
  ) {
    // For the middle bracket the funding can go in either bracket
    // it depends on closer distance from the currentPrice to the limit prices fo the bracket-traders
    return (
      (bracketExchangeBalanceStableToken === "0" &&
        bracketExchangeBalanceTargetToken === investmentTargetTokenPerBracket.toString()) ||
      (bracketExchangeBalanceTargetToken === "0" &&
        bracketExchangeBalanceStableToken === investmentStableTokenPerBracket.toString())
    )
  }

  const areBoundsReasonable = function(currentPrice, lowestLimit, highestLimit) {
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
  const getDexagPrice = async function(tokenBought, tokenSold, globalPriceStorage = null) {
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

  const isPriceReasonable = async (targetTokenData, stableTokenData, price, acceptedPriceDeviationInPercentage = 2) => {
    const dexagPrice = await getDexagPrice(stableTokenData.symbol, targetTokenData.symbol)
    if (dexagPrice === undefined) {
      console.log("Warning: could not perform price check against dex.ag.")
      return false
    } else if (Math.abs(dexagPrice - price) / price >= acceptedPriceDeviationInPercentage / 100) {
      console.log(
        "Warning: the chosen price differs by more than",
        acceptedPriceDeviationInPercentage,
        "percent from the price found on dex.ag."
      )
      console.log("         chosen price:", price, stableTokenData.symbol, "bought for 1", targetTokenData.symbol)
      console.log("         dex.ag price:", dexagPrice, stableTokenData.symbol, "bought for 1", targetTokenData.symbol)
      return false
    }
    return true
  }

  /**
   * Midifies the price to work with ERC20 units
   * @param {number} price amount of stable token in exchange for one target token
   * @param {integer} targetTokenDecimals number of decimals of the target token
   * @param {integer} stableTokenDecimals number of decimals of the stable token
   * @return {Fraction} fraction representing the amount of units of stable tokens in exchange for one unit of target token
   */
  const getUnitPrice = function(price, targetTokenDecimals, stableTokenDecimals) {
    return Fraction.fromNumber(price).mul(
      new Fraction(new BN(10).pow(new BN(stableTokenDecimals)), new BN(10).pow(new BN(targetTokenDecimals)))
    )
  }

  /**
   * Computes the amount of output token units from their price and the amount of input token units
   * Note that the price is expressed in terms of tokens, while the amounts are in terms of token units
   * @param {number} price amount of stable token in exchange for one target token
   * @param {BN} targetTokenAmount amount of target token units that are exchanged at price
   * @param {integer} targetTokenDecimals number of decimals of the target token
   * @param {integer} stableTokenDecimals number of decimals of the stable token
   * @return {BN} amount of output token units obtained
   */
  const getOutputAmountFromPrice = function(price, targetTokenAmount, targetTokenDecimals, stableTokenDecimals) {
    const unitPriceFraction = getUnitPrice(price, targetTokenDecimals, stableTokenDecimals)
    const stableTokenAmountFraction = unitPriceFraction.mul(new Fraction(targetTokenAmount, 1))
    return stableTokenAmountFraction.toBN()
  }

  /**
   * Computes the stable and target token amounts needed to set up an unlimited order in the exchange
   * @param {number} price amount of stable tokens in exchange for one target token
   * @param {integer} targetTokenDecimals number of decimals of the target token
   * @param {integer} stableTokenDecimals number of decimals of the stable token
   * @return {BN[2]} amounts of stable token and target token for an unlimited order at the input price
   */
  const getUnlimitedOrderAmounts = function(price, targetTokenDecimals, stableTokenDecimals) {
    let targetTokenAmount = max128.clone()
    let stableTokenAmount = getOutputAmountFromPrice(price, targetTokenAmount, targetTokenDecimals, stableTokenDecimals)
    if (stableTokenAmount.gt(targetTokenAmount)) {
      stableTokenAmount = max128.clone()
      targetTokenAmount = getOutputAmountFromPrice(1 / price, stableTokenAmount, stableTokenDecimals, targetTokenDecimals)
      assert(stableTokenAmount.gte(targetTokenAmount), "Error: unable to create unlimited order")
    }
    return [targetTokenAmount, stableTokenAmount]
  }

  const checkNoProfitableOffer = async (order, exchange, tokenInfo, globalPriceStorage = null) => {
    const currentMarketPrice = await getDexagPrice(
      (await tokenInfo[order.buyToken]).symbol,
      (await tokenInfo[order.sellToken]).symbol,
      globalPriceStorage
    )

    // checks whether the order amount is negligible
    if (Math.floor(await orderSellValueInUSD(order, tokenInfo, globalPriceStorage)) < 1) {
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

    return fromErc20Units(
      toErc20Units(currentMarketPrice, precisionDecimals)
        .mul(order.sellTokenBalance)
        .div(new BN(10).pow(new BN((await tokenInfo[order.sellToken]).decimals))),
      precisionDecimals
    )
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
