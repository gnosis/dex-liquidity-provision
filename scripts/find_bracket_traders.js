const { isOnlySafeOwner } = require("./utils/trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
  })
  .demand(["masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    // Init params
    const ProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol")

    const proxyFactory = await ProxyFactory.deployed()
    const eventData = await proxyFactory.getPastEvents("ProxyCreation", { fromBlock: 0, toBlock: "latest" })
    const safeDeployments = eventData.map(event => event.args[0]).slice(-100)
    console.log("In total we have ", safeDeployments.length, " safe deployments")
    const isDeployedByMaster = await Promise.all(
      safeDeployments.map(async bracketTrader => await isOnlySafeOwner(argv.masterSafe, bracketTrader, artifacts))
    )
    const bracketTraderAddresses = safeDeployments.filter((bracketTrader, index) => isDeployedByMaster[index])
    console.log("And ", bracketTraderAddresses.length, " safes are used for the bracket strategy of your master safe")
    console.log("All brackets are: ", bracketTraderAddresses.join(","))

    callback()
  } catch (error) {
    callback(error)
  }
}
