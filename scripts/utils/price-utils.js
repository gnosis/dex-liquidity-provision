const axios = require("axios")
const { fetchTokenInfo } = require("./trading_strategy_helpers")

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

const isPriceReasonable = async function(
  exchange,
  targetTokenId,
  stableTokenId,
  price,
  artifacts = artifacts,
  acceptedPriceDeviationInPercentage = 2
) {
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId], artifacts)
  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
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
    console.log("         chosen price:", price, targetToken.symbol, "bought for 1", stableToken.symbol)
    console.log("         dex.ag price:", dexagPrice, targetToken.symbol, "bought for 1", stableToken.symbol)
    return false
  }
  return true
}

module.exports = {
  isPriceReasonable,
}
