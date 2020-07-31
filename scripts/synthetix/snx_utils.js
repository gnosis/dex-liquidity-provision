const tokenDetails = async function (snxInstance, batchExchange, tokenName) {
  const address = web3.utils.toChecksumAddress(snxInstance[tokenName].contract.address)
  const [key, tokenId, decimals] = await Promise.all([
    snxInstance[tokenName].currencyKey(),
    batchExchange.tokenAddressToIdMap.call(address),
    snxInstance[tokenName].decimals(),
  ])

  return {
    name: tokenName,
    key: key,
    exchangeId: tokenId.toNumber(),
    address: address,
    decimals: decimals,
  }
}

const gasStationURL = {
  1: "https://safe-relay.gnosis.io/api/v1/gas-station/",
  4: "https://safe-relay.rinkeby.gnosis.io/api/v1/gas-station/",
}

const estimationURLPrexix = {
  1: "https://dex-price-estimator.gnosis.io//api/v1/",
  4: "https://dex-price-estimator.rinkeby.gnosis.io//api/v1/",
}

const estimatePrice = async function (buyTokenId, sellTokenId, sellAmount, networkId) {
  const searchCriteria = `markets/${buyTokenId}-${sellTokenId}/estimated-buy-amount/${sellAmount}?atoms=true`
  const estimationData = await (await fetch(estimationURLPrexix[networkId] + searchCriteria)).json()

  return estimationData.buyAmountInBase / estimationData.sellAmountInQuote
}

const estimatedTxCostUSD = async function (gas, gasPrice, ethPrice) {
  const ethAmount = gas * gasPrice
  const txCost = ethAmount * ethPrice
  // console.log("ETH cost of order placement", txCost)
  return txCost
}

// This estimate is a hard lower bound on the surplus made on a matched trade
// It computes the fees earned on the buy amount.
const estimatedSurplus = async function (order, sellToken, exchangeFee) {
  // buyAmount is BN and exchangeFee is a float which can't be multiplied.
  // Note that sUSD to sETH fee is 0.005 which is still a decimal in BPS.
  // So we must use DBPS (a term I made up for deci-BPS)
  const feeDBPS = parseInt(1000 * exchangeFee)
  const surplusWEI = order.buyAmount.mul(feeDBPS).div(1000)
  console.log(surplusWEI)
  // TODO - FINISH ME
}

module.exports = {
  estimatePrice,
  estimatedSurplus,
  estimatedTxCostUSD,
  gasStationURL,
  tokenDetails,
}
