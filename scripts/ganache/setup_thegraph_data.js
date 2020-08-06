const { deployNewStrategy } = require("../utils/test_and_script_code")(web3, artifacts)
const BatchExchange = artifacts.require("BatchExchange")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")

module.exports = async (callback) => {
  const tradeInfo = {
    numBrackets: 2,
    lowestLimit: 100,
    highestLimit: 300,
    currentPrice: 200,
    amountQuoteToken: 10,
    amountbaseToken: 10,
    quoteTokenInfo: { symbol: "DAI", decimals: 18 },
    baseTokenInfo: { symbol: "WETH", decimals: 18 },
  }
  try {
    const safeOwner = await web3.eth.getAccounts().then((accounts) => accounts[0])
    const proxyFactory = await ProxyFactory.deployed()
    const exchange = await BatchExchange.deployed()
    const gnosisSafeMasterCopy = await GnosisSafe.new()
    await deployNewStrategy(tradeInfo, gnosisSafeMasterCopy, proxyFactory, safeOwner, exchange, accounts)
    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
