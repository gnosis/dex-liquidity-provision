const { SynthetixJs } = require("synthetix-js")
const fetch = require("node-fetch")
const { getUnlimitedOrderAmounts } = require("@gnosis.pm/dex-contracts")
const { default_yargs } = require("../utils/default_yargs")
const { floatToErc20Units } = require("../utils/printing_tools")
const { getExchange } = require("../utils/trading_strategy_helpers")(web3, artifacts)

const argv = default_yargs
  .option("gasPrice", {
    type: "string",
    describe: "Gas price to be used for order submission",
    choices: ["lowest", "safeLow", "standard", "fast", "fastest"],
    default: "standard",
  })
  .option("gasPriceScale", {
    type: "float",
    describe: "Scale used as a multiplier to the gas price",
    default: 1.0,
  }).argv

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

const economicallyViable = async function (gas, gasPrice) {
  const ethAmount = gas * gasPrice
  console.log("ETH cost of order placement", ethAmount)
  return false
}

const MIN_SELL_USD = 10

/* All prices, except those explicitly named with "inverted" refer to the price of sETH in sUSD.
 * The term "our" is with regards to prices we, the synthetix bot, are buying and selling for while
 * the term "their" refers to the buy and sell prices offered by the Gnosis Protocol.
 * For example, if ourBuyPrice = 100 and theirSellPrice = 90, this means that
 * the synthetix platform is willing to spend 100 sUSD for 1 sETH
 * and the Gnosis Protocol is currently offering 1 sETH for 90 sUSD.
 */
module.exports = async (callback) => {
  try {
    const networkId = await web3.eth.net.getId()
    const account = (await web3.eth.getAccounts())[0]
    console.log("Using account", account)

    const snxjs = new SynthetixJs({ networkId: networkId })
    const batchExchange = await getExchange()

    const [sETH, sUSD] = await Promise.all([
      tokenDetails(snxjs, batchExchange, "sETH"),
      tokenDetails(snxjs, batchExchange, "sUSD"),
    ])

    // Compute Rates and Fees based on price of sETH.
    // Note that sUSD always has a price of 1 within synthetix protocol.
    const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETH.key)
    const formatedRate = snxjs.utils.formatEther(exchangeRate)
    console.log("Oracle sETH Price (in sUSD)", formatedRate)

    const minSellsUSD = floatToErc20Units(MIN_SELL_USD, sUSD.decimals)
    const theirSellPriceInverted = await estimatePrice(sETH.exchangeId, sUSD.exchangeId, minSellsUSD, networkId)
    const theirSellPrice = 1 / theirSellPriceInverted
    console.log("Gnosis Protocol sell sETH price (in sUSD)", theirSellPrice)

    const minSellsETH = floatToErc20Units(MIN_SELL_USD / formatedRate, sETH.decimals)
    const theirBuyPrice = await estimatePrice(sUSD.exchangeId, sETH.exchangeId, minSellsETH, networkId)
    console.log("Gnosis Protocol buy  sETH price (in sUSD)", theirBuyPrice)

    // Using synthetix's fees, and formatting their return values with their tools, plus parseFloat.
    const sETHTosUSDFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sETH.key, sUSD.key)))
    const sUSDTosETHFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sUSD.key, sETH.key)))

    // Initialize order array.
    const orders = []

    // Compute buy-sell amounts based on unlimited orders with rates from above when the price is right.
    const ourBuyPrice = formatedRate * (1 - sUSDTosETHFee)
    if (ourBuyPrice > theirSellPrice) {
      // We are willing to pay more than the exchange is selling for.
      console.log(`Placing an order to buy sETH at ${ourBuyPrice}, but verifying sUSD balance first`)
      // const sUSDBalance = await batchExchange.getBalance(account, sUSD.address)
      // if (sUSDBalance.gte(minSellsUSD)) {
      const { base: sellSUSDAmount, quote: buyETHAmount } = getUnlimitedOrderAmounts(
        1 / ourBuyPrice,
        sETH.decimals,
        sUSD.decimals
      )
      orders.push({
        buyToken: sETH.exchangeId,
        sellToken: sUSD.exchangeId,
        buyAmount: buyETHAmount,
        sellAmount: sellSUSDAmount,
      })
      // } else {
      //   console.log(`Warning: Insufficient sUSD (${sUSDBalance.toString()} < ${minSellsUSD.toString()}) for order placement.`)
      // }
    } else {
      console.log(`Not placing buy  sETH order, our rate of ${ourBuyPrice.toFixed(2)} is too low  for exchange.`)
    }

    const ourSellPrice = formatedRate * (1 + sETHTosUSDFee)
    if (ourSellPrice < theirBuyPrice) {
      // We are selling at a price less than the exchange is buying for.
      console.log(`Placing an order to sell sETH at ${ourSellPrice}, but verifying sETH balance first`)
      const sETHBalance = await batchExchange.getBalance(account, sETH.address)
      if (sETHBalance.gte(minSellsETH)) {
        const { base: sellETHAmount, quote: buySUSDAmount } = getUnlimitedOrderAmounts(
          ourSellPrice,
          sUSD.decimals,
          sETH.decimals
        )
        orders.push({
          buyToken: sUSD.exchangeId,
          sellToken: sETH.exchangeId,
          buyAmount: buySUSDAmount,
          sellAmount: sellETHAmount,
        })
      } else {
        console.log(`Warning: Insufficient sETH (${sETHBalance.toString()} < ${minSellsETH.toString()}) for order placement.`)
      }
    } else {
      console.log(`Not placing sell sETH order, our rate of ${ourSellPrice.toFixed(2)} is too high for exchange.`)
    }

    if (orders.length > 0) {
      // Fetch auction index and declare validity interval for orders.
      // Note that order validity interval is inclusive on both sides.
      const batchId = (await batchExchange.getCurrentBatchId.call()).toNumber()
      const validFroms = Array(orders.length).fill(batchId)
      const validTos = Array(orders.length).fill(batchId)

      const gasPrices = await (await fetch(gasStationURL[networkId])).json()
      const scaledGasPrice = parseInt(gasPrices[argv.gasPrice] * argv.gasPriceScale)
      console.log(`Using current "${argv.gasPrice}" gas price scaled by ${argv.gasPriceScale}: ${scaledGasPrice}`)

      const gasEstimate = await batchExchange.contract.methods
        .placeValidFromOrders(
          orders.map((order) => order.buyToken),
          orders.map((order) => order.sellToken),
          validFroms,
          validTos,
          orders.map((order) => order.buyAmount.toString(10)),
          orders.map((order) => order.sellAmount.toString(10))
        )
        .estimateGas({
          from: account,
          gasPrice: scaledGasPrice,
        })
        .then(function (gasAmount) {
          return gasAmount
        })
        .catch(function (error) {
          callback(error)
        })
      console.log("Gas Estimation", gasEstimate)
      console.log(economicallyViable(gasEstimate, scaledGasPrice))
      0.009230580000097164
      // if (economicallyViable(gasEstimate, scaledGasPrice)) {
      //   await batchExchange.placeValidFromOrders(
      //     orders.map((order) => order.buyToken),
      //     orders.map((order) => order.sellToken),
      //     validFroms,
      //     validTos,
      //     orders.map((order) => order.buyAmount),
      //     orders.map((order) => order.sellAmount),
      //     {
      //       from: account,
      //       gasPrice: scaledGasPrice,
      //     }
      //   )
      // }
    }
    callback()
  } catch (error) {
    callback(error)
  }
}
