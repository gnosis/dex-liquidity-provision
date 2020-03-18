const Contract = require("@truffle/contract")
const { getOrdersPaginated, printOrder } = require("./utils/to_be_imported_from_dex_contracts.js")

const argv = require("yargs")
  .option("brackets", {
    type: "string",
    describe:
      "Trader account addresses for displaying their information, they can be obtained via the script find_bracket_traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .demand(["brackets"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    const ERC20Detailed = artifacts.require("ERC20Detailed")
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)

    const bracketTraderAddresses = argv.brackets.map(address => address.toLowerCase())
    const exchange = await BatchExchange.deployed()
    const batchId = (await exchange.getCurrentBatchId()).toNumber()
    const auctionElementsDecoded = await getOrdersPaginated(exchange, 100)

    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)

        if (relevantOrders.length > 0) {
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
              console.log(`The balance of the trader ${bracketTrader} is ${tokenBalance} ${symbol}`)
              const ordersWithSameSellToken = relevantOrders.filter(order => order.sellToken == tokenId)
              ordersWithSameSellToken.forEach(order => printOrder(order, batchId))
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
