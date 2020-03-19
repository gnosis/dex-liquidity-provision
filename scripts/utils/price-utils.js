module.exports = function(web3 = web3, artifacts = artifacts) {
  const axios = require("axios")
  const BN = require("bn.js")
  const exchangeUtils = require("@gnosis.pm/dex-contracts")

  const { fetchTokenInfoFromExchange } = require("./trading_strategy_helpers")(web3, artifacts)

  const checkCorrectnessOfDeposits = async (
    targetPrice,
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
    const bracketOrders = auctionElements.filter(order => order.user.toLowerCase() == bracketAddress.toLowerCase())
    const stableTokenId = await exchange.tokenAddressToIdMap.call(stableToken.address)
    const sellStableTokenOrder = bracketOrders.filter(order => order.sellToken == stableTokenId)[0]

    const targetTokenId = await exchange.tokenAddressToIdMap.call(targetToken.address)
    const sellTargetTokenOrder = bracketOrders.filter(order => order.sellToken == targetTokenId)[0]

    // Check that tokens with a lower price than the target price are funded with stableTokens
    if (checkThatOrderPriceIsBelowTarget(targetPrice, sellStableTokenOrder)) {
      // checks whether price is in middle of bracket:
      if (checkThatOrderPriceIsBelowTarget(1 / targetPrice, sellTargetTokenOrder)) {
        assert.isTrue(
          checkFundingInTheMiddleBracket(
            bracketExchangeBalanceStableToken,
            bracketExchangeBalanceTargetToken,
            investmentTargetTokenPerBracket,
            investmentStableTokenPerBracket
          )
        )
      } else {
        assert.equal(bracketExchangeBalanceStableToken, investmentStableTokenPerBracket.toString())
      }
    } else {
      assert.equal(bracketExchangeBalanceStableToken, 0)
    }

    if (checkThatOrderPriceIsBelowTarget(1 / targetPrice, sellTargetTokenOrder)) {
      if (checkThatOrderPriceIsBelowTarget(targetPrice, sellStableTokenOrder)) {
        assert.isTrue(
          checkFundingInTheMiddleBracket(
            bracketExchangeBalanceStableToken,
            bracketExchangeBalanceTargetToken,
            investmentTargetTokenPerBracket,
            investmentStableTokenPerBracket
          )
        )
      } else {
        assert.equal(bracketExchangeBalanceTargetToken, investmentTargetTokenPerBracket.toString())
      }
    } else {
      assert.equal(bracketExchangeBalanceTargetToken, 0)
    }
  }

  const checkThatOrderPriceIsBelowTarget = function(targetPrice, order) {
    const multiplicator = 1000000000
    return new BN(targetPrice * multiplicator).mul(order.priceNumerator) > order.priceDenominator.mul(new BN(multiplicator))
  }

  const checkFundingInTheMiddleBracket = function(
    bracketExchangeBalanceStableToken,
    bracketExchangeBalanceTargetToken,
    investmentTargetTokenPerBracket,
    investmentStableTokenPerBracket
  ) {
    // For the middle bracket the funding can go in either bracket
    // it depends on closer distance from the targetPrice to the limit prices fo the bracket-traders
    return (
      (bracketExchangeBalanceStableToken == 0 &&
        bracketExchangeBalanceTargetToken == investmentTargetTokenPerBracket.toString()) ||
      (bracketExchangeBalanceTargetToken == 0 && bracketExchangeBalanceStableToken == investmentStableTokenPerBracket.toString())
    )
  }

  const areBoundsReasonable = function(targetPrice, lowestLimit, highestLimit) {
    const boundsCloseToTargetPrice = targetPrice / 1.5 < lowestLimit && highestLimit < targetPrice * 1.5
    if (!boundsCloseToTargetPrice) {
      console.log("Please double check your bounds. They seem to be unreasonable")
    }
    const targetPriceWithinBounds = targetPrice > lowestLimit && highestLimit < targetPrice
    if (!targetPriceWithinBounds) {
      console.log("Please double check your bounds. Current price is not within the bounds")
    }
    return targetPriceWithinBounds && boundsCloseToTargetPrice
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
