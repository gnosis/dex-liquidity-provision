const { SynthetixJs } = require("synthetix-js")
const BN = require("bn.js")
const ethers = require("ethers")
const fetch = require("node-fetch")
const { getUnlimitedOrderAmounts } = require("@gnosis.pm/dex-contracts")
const { default_yargs } = require("../utils/default_yargs")

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

// These are fixed constants for the current version of the dex-contracts
const sETHByNetwork = {
  1: {
    address: "0x5e74C9036fb86BD7eCdcb084a0673EFc32eA31cb",
    exchangeId: 8,
    decimals: 18,
  },
  4: {
    address: "0x0647b2C7a2a818276154b0fC79557F512B165bc1",
    exchangeId: 12,
    decimals: 18,
  },
}

const sUSDByNetwork = {
  1: {
    address: "0x57Ab1E02fEE23774580C119740129eAC7081e9D3",
    exchangeId: 9,
    decimals: 18,
  },
  4: {
    address: "0x1b642a124CDFa1E5835276A6ddAA6CFC4B35d52c",
    exchangeId: 13,
    decimals: 18,
  },
}

const gasStationURL = {
  1: "https://safe-relay.gnosis.io/api/v1/gas-station/",
  4: "https://safe-relay.rinkeby.gnosis.io/api/v1/gas-station/",
}

const toWEI = function (value, decimals) {
  const h = Math.floor(decimals / 2)
  const a = new BN(10).pow(new BN(h))
  const b = new BN(10).pow(new BN(decimals - h))

  return new BN(value * a).mul(new BN(b))
}

const estimationURLPrexix = {
  1: "https://dex-price-estimator.gnosis.io//api/v1/",
  4: "https://dex-price-estimator.rinkeby.gnosis.io//api/v1/",
}

const estimatePrice = async function (buyTokenId, sellTokenId, amount, networkId) {
  const searchCriteria = `markets/${buyTokenId}-${sellTokenId}/estimated-buy-amount/${amount}?atoms=true`
  const estimationData = await (await fetch(estimationURLPrexix[networkId] + searchCriteria)).json()

  return estimationData.buyAmountInBase / estimationData.sellAmountInQuote
}

const MIN_SELL_USD = 10

module.exports = async (callback) => {
  try {
    const networkId = await web3.eth.net.getId()
    const account = (await web3.eth.getAccounts())[0]
    console.log("Using account", account)

    const snxjs = new SynthetixJs({ networkId: networkId })
    const exchange = await getExchange(web3)

    const sETH = sETHByNetwork[networkId]
    const sUSD = sUSDByNetwork[networkId]

    // Both of these hardcoded tokens are assumed to have 18 decimal places.
    // We "trust" that this will always be the case although it seems
    // that synthetix reserves the authority to upgrade their token
    // This could mean issuing a new one with a different number of decimals.
    const sETHKey = ethers.utils.formatBytes32String("sETH")
    const sUSDKey = ethers.utils.formatBytes32String("sUSD")

    // Compute Rates and Fees based on price of sETH.
    // Note that sUSD always has a price of 1 within synthetix protocol.
    const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETHKey)
    const formatedRate = snxjs.utils.formatEther(exchangeRate)
    console.log("Oracle sETH Price (in sUSD)", formatedRate)

    const exchangeBuyETHPrice = await estimatePrice(
      sETH.exchangeId,
      sUSD.exchangeId,
      toWEI(MIN_SELL_USD, sUSD.decimals),
      networkId
    )
    console.log("Exchange buy  sETH price (in sUSD)", 1 / exchangeBuyETHPrice)

    const minSellETH = toWEI(MIN_SELL_USD / formatedRate, sETH.decimals)
    const exchangeSellETHPrice = await estimatePrice(sUSD.exchangeId, sETH.exchangeId, minSellETH, networkId)
    console.log("Exchange sell sETH price (in sUSD)", exchangeSellETHPrice)

    // Using synthetix's fees, and formatting their return values with their tools, plus parseFloat.
    const sETHTosUSDFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sETHKey, sUSDKey)))
    const sUSDTosETHFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sUSDKey, sETHKey)))

    // Initialize order array.
    const orders = []

    // Compute buy-sell amounts based on unlimited orders with rates from above when the price is right.
    const ourBuyETHRate = formatedRate * (1 - sUSDTosETHFee)
    if (ourBuyETHRate < exchangeBuyETHPrice) {
      console.log(`Placing an order to buy sETH at ${ourBuyETHRate}`)
      const { base: sellSUSDAmount, quote: buyETHAmount } = getUnlimitedOrderAmounts(
        1 / ourBuyETHRate,
        sETH.decimals,
        sUSD.decimals
      )
      orders.push({
        buyToken: sETH.exchangeId,
        sellToken: sUSD.exchangeId,
        buyAmount: buyETHAmount,
        sellAmount: sellSUSDAmount,
      })
    } else {
      console.log(`Not placing buy  sETH order, our rate of ${ourBuyETHRate.toFixed(2)} is too low  for exchange.`)
    }

    const ourSellETHRate = formatedRate * (1 + sETHTosUSDFee)
    if (ourSellETHRate < exchangeSellETHPrice) {
      console.log(`Placing an order to sell sETH at ${ourSellETHRate}`)
      const { base: sellETHAmount, quote: buySUSDAmount } = getUnlimitedOrderAmounts(
        formatedRate * (1 + sETHTosUSDFee),
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
      console.log(`Not placing sell sETH order, our rate of ${ourSellETHRate.toFixed(2)} is too high for exchange.`)
    }

    if (orders.length > 0) {
      // Fetch auction index and declare validity interval for orders.
      // Note that order validity interval is inclusive on both sides.
      const batchId = (await exchange.getCurrentBatchId.call()).toNumber()
      const validFroms = Array(orders.length).fill(batchId)
      const validTos = Array(orders.length).fill(batchId)

      const gasPrices = await (await fetch(gasStationURL[networkId])).json()
      const scaledGasPrice = parseInt(gasPrices[argv.gasPrice] * argv.gasPriceScale)
      console.log(`Using current "${argv.gasPrice}" gas price scaled by ${argv.gasPriceScale}: ${scaledGasPrice}`)
      await exchange.placeValidFromOrders(
        orders.map((order) => order.buyToken),
        orders.map((order) => order.sellToken),
        validFroms,
        validTos,
        orders.map((order) => order.buyAmount),
        orders.map((order) => order.sellAmount),
        {
          from: account,
          gasPrice: scaledGasPrice,
        }
      )
    }
    callback()
  } catch (error) {
    callback(error)
  }
}
