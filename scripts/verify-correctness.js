const Contract = require("@truffle/contract")
const { getOrdersPaginated } = require("./utils/to_be_imported_from_dex_contracts.js")
const { isOnlySafeOwner } = require("./utils/trading_strategy_helpers")
const { getMasterCopy } = require("./utils/internals")
const { toErc20Units } = require("./utils/printing_tools")
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
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)

    const bracketTraderAddresses = argv.brackets.map(address => address.toLowerCase())
    const exchange = await BatchExchange.deployed()
    const auctionElementsDecoded = await getOrdersPaginated(exchange, 100)

    // 1. verify that the owner of the brackets is the masterSafe
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        await isOnlySafeOwner(argv.masterSafe, bracketTrader, artifacts)
      })
    )

    // 2. verify that all proxies of the brackets are pointing to the right gnosis-safe proxy:
    const GnosisSafe = artifacts.require("GnosisSafe")
    const gnosisSafe = await GnosisSafe.deployed()
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await getMasterCopy(bracketTrader), gnosisSafe.address)
      })
    )

    // 3. verify that each bracket has only two orders
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)
        assert(relevantOrders.length == 2)
      })
    )

    // 4. verify that each bracket can not loose tokens by consecutive selling and buying via the two orders
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)

        // Checks that selling an initial amount and then re-buying it with the second order is profitable.
        const initialAmount = toErc20Units(1, 18)
        const amountAfterSelling = initialAmount.mul(relevantOrders[0].priceNumerator).div(relevantOrders[0].priceDenominator)
        const amountAfterBuying = amountAfterSelling
          .mul(relevantOrders[1].priceNumerator)
          .div(relevantOrders[1].priceDenominator)
        assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")
        // If the last equation holds, the inverse trade must be profitable as well
      })
    )
    callback()
  } catch (error) {
    callback(error)
  }
}
