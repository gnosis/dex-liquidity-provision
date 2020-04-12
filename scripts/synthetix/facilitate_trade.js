const { SynthetixJs } = require("synthetix-js")
const ethers = require("ethers")
const fetch = require("node-fetch")

const { getExchange } = require("../utils/trading_strategy_helpers")(web3, artifacts)
const { getUnlimitedOrderAmounts } = require("../utils/trading_strategy_helpers")(web3, artifacts)

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
  4: "https://safe-relay.rinkeby.gnosis.io/api/v1/gas-station/"
}

module.exports = async callback => {
  try {
    const networkId = await web3.eth.net.getId()
    const gasPrices = await (await fetch(gasStationURL[networkId])).json()

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
    console.log("sETH Price", snxjs.utils.formatEther(exchangeRate))

    // Using synthetix's fees, and formatting their return values with their tools, plus parseFloat.
    const sETHTosUSDFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sETHKey, sUSDKey)))
    const sUSDTosETHFee = parseFloat(snxjs.utils.formatEther(await snxjs.Exchanger.feeRateForExchange(sUSDKey, sETHKey)))

    // Compute buy-sell amounts based on unlimited orders with rates from above.
    const [buyETHAmount, sellSUSDAmount] = getUnlimitedOrderAmounts(formatedRate * (1 - sUSDTosETHFee), sUSD, sETH)
    const [sellETHAmount, buySUSDAmount] = getUnlimitedOrderAmounts(formatedRate * (1 + sETHTosUSDFee), sETH, sUSD)

    const buyAmounts = [buyETHAmount, buySUSDAmount]
    const sellAmounts = [sellSUSDAmount, sellETHAmount]

    // Fetch auction index and declare validity interval for orders.
    // Note that order validity interval is inclusive on both sides.
    const batchId = (await exchange.getCurrentBatchId.call()).toNumber()
    const validFroms = Array(2).fill(batchId)
    const validTos = Array(2).fill(batchId)

    // Avoid querying exchange by tokenAddress for fixed tokenId
    const buyTokens = [sETH, sUSD].map(token => token.exchangeId)
    const sellTokens = [sUSD, sETH].map(token => token.exchangeId)

    await exchange.placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts, {
      from: account,
      gasPrice: gasPrices.fast
    })
    callback()
  } catch (error) {
    callback(error)
  }
}
