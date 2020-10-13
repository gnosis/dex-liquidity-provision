const { deployNewStrategy } = require("../utils/strategy_simulator")(web3, artifacts)
const BatchExchange = artifacts.require("BatchExchange")
const { GnosisSafe } = require("../utils/dependencies")(web3, artifacts)
const { GnosisSafeProxyFactory } = require("../utils/dependencies")(web3, artifacts)
const { default_yargs } = require("../utils/default_yargs")
const argv = default_yargs.argv

module.exports = async (callback) => {
  const strategyConfig = {
    numBrackets: 2,
    lowestLimit: 100,
    highestLimit: 300,
    currentPrice: 200,
    amountQuoteToken: 2000,
    amountbaseToken: 10,
    quoteTokenInfo: { symbol: "DAI", decimals: 18 },
    baseTokenInfo: { symbol: "WETH", decimals: 18 },
  }
  try {
    if (argv.network == "mainnet") callback("Error: don't run this script on mainnet")
    const accounts = await web3.eth.getAccounts()
    const safeOwner = accounts[0]
    const proxyFactory = await GnosisSafeProxyFactory.deployed()
    const exchange = await BatchExchange.deployed()
    const gnosisSafeMasterCopy = await GnosisSafe.new()
    await deployNewStrategy(strategyConfig, gnosisSafeMasterCopy, proxyFactory, safeOwner, exchange, accounts)
    callback()
  } catch (error) {
    callback(error)
  }
}
