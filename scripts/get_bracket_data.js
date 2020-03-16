const Contract = require("@truffle/contract")
const { getOrdersPaginated, printOrder } = require("./utils/to_be_imported_from_dex_contracts.js")
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
    const ERC20Detailed = artifacts.require("ERC20Detailed")
    const ProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol")

    const proxyFactory = await ProxyFactory.deployed()
    const eventData = await proxyFactory.getPastEvents("ProxyCreation", { fromBlock: 0, toBlock: "latest" })
    const safeDeployments = eventData.map(event => event.args[0]).slice(-100)
    //For easy rinkeby testing use:
    //bracketTraderAddresses = ['0xc867f926392a4e55b8800afbbbad8c99efd70e49']
    console.log("In total we have ", safeDeployments.length, " safe deployments")
    const isDeployedByMaster = await Promise.all(
      safeDeployments.map(async bracketTrader => await isOnlySafeOwner(argv.masterSafe, bracketTrader, artifacts))
    )
    let bracketTraderAddresses = safeDeployments.filter((bracketTrader, index) => isDeployedByMaster[index])
    console.log("And ", bracketTraderAddresses.length, " safes are used for the bracket strategy of your master safe")

    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    const exchange = await BatchExchange.deployed()
    const batchId = (await exchange.getCurrentBatchId()).toNumber()

    const auctionElementsDecoded = await getOrdersPaginated(exchange, 100)

    bracketTraderAddresses = bracketTraderAddresses.map(address => address.toLowerCase())
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)

        if (relevantOrders.length > 0) {
          console.log(`The orders of the bracket trader ${bracketTrader} are:`)
          relevantOrders.forEach(order => printOrder(order, batchId))
          let tokenSet = new Set()
          relevantOrders.forEach(order => {
            tokenSet.add(order.buyToken)
            tokenSet.add(order.sellToken)
          })
          tokenSet = Array.from(tokenSet)
          await Promise.all(
            tokenSet.map(async tokenId => {
              const tokenAddress = await exchange.tokenIdToAddressMap.call(tokenId)
              const tokenBalance = await exchange.getBalance.call(bracketTrader, tokenAddress)
              const erc20 = await ERC20Detailed.at(tokenAddress)
              const symbol = await erc20.symbol.call()
              console.log(`And the balance of the trader ${bracketTrader} is ${tokenBalance} ${symbol}`)
            })
          )
        }
      })
    )
    callback()
  } catch (error) {
    callback(error)
  }
}
