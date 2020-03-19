module.exports = function(web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const BN = require("bn.js")
  const exchangeUtils = require("@gnosis.pm/dex-contracts")

  const { fetchTokenInfoFromExchange } = require("./trading_strategy_helpers")(web3, artifacts)

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
    investmentStableTokenPerBracket
    investmentTargetTokenPerBracket,
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
    const currentPriceWithinBounds = currentPrice > lowestLimit && highestLimit < currentPrice
    if (!currentPriceWithinBounds) {
      console.log("Please double check your bounds. Current price is not within the bounds")
    }
    return currentPriceWithinBounds && boundsCloseTocurrentPrice
  }

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

  const isPriceReasonable = async (exchange, targetTokenId, stableTokenId, price, acceptedPriceDeviationInPercentage = 2) => {
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [targetTokenId, stableTokenId])
    const targetToken = await tokenInfoPromises[targetTokenId]
    const stableToken = await tokenInfoPromises[stableTokenId]
    const dexagPrice = await getDexagPrice(stableToken.symbol, targetToken.symbol)
    if (dexagPrice === undefined) {
      console.log("Warning: could not perform price check against dex.ag.")
      return false
    } else if (Math.abs(dexagPrice - price) / price >= acceptedPriceDeviationInPercentage / 100) {
      console.log(
        "Warning: the chosen price differs by more than",
        acceptedPriceDeviationInPercentage,
        "percent from the price found on dex.ag."
      )
      console.log("         chosen price:", price, stableToken.symbol, "bought for 1", targetToken.symbol)
      console.log("         dex.ag price:", dexagPrice, stableToken.symbol, "bought for 1", targetToken.symbol)
      return false
    }
    return true
  }

  return {
    isPriceReasonable,
    areBoundsReasonable,
    checkCorrectnessOfDeposits,
  }
}
