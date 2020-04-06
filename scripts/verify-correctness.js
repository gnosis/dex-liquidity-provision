const { getOrdersPaginated } = require("../node_modules/@gnosis.pm/dex-contracts/src/onchain_reading")
const Contract = require("@truffle/contract")

const { isOnlySafeOwner } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { getMasterCopy } = require("./utils/internals")(web3, artifacts)
const { toErc20Units } = require("./utils/printing_tools")
const { getDexagPrice } = require("./utils/price-utils")(web3, artifacts)
const { checkNoProfitableOffer } = require("./utils/price-utils")(web3, artifacts)
const { fetchTokenInfoFromExchange } = require("./utils/trading_strategy_helpers")(web3, artifacts)

const assert = require("assert")
const BN = require("bn.js")
const argv = require("yargs")
  .option("brackets", {
    type: "string",
    describe:
      "Trader account addresses for displaying their information, they can be obtained via the script find_bracket_traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .option("masterSafe", {
    type: "string",
    describe: "The masterSafe in control of the bracket-traders",
    coerce: str => {
      return str.split(",")
    },
  })
  .demand(["brackets", "masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    const BatchExchangeArtifact = require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
    const networkId = await web3.eth.net.getId()
    const BatchExchange = new web3.eth.Contract(BatchExchangeArtifact.abi, BatchExchangeArtifact.networks[networkId].address)

    const auctionElementsDecoded = await getOrdersPaginated(BatchExchange, 100)
    const bracketTraderAddresses = argv.brackets.map(address => address.toLowerCase())
    // fetch all token infos(decimals, symbols etc) and prices upfront for the following verification
    const globalPriceStorage = {}
    const relevantOrders = auctionElementsDecoded.filter(order => bracketTraderAddresses.includes(order.user.toLowerCase()))
    const BatchExchangeContract = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchangeContract.setNetwork(web3.network_id)
    BatchExchangeContract.setProvider(web3.currentProvider)
    const exchange = await BatchExchangeContract.deployed()
    for (const order of relevantOrders) {
      const tokenInfo = await fetchTokenInfoFromExchange(exchange, [order.sellToken, order.buyToken])
      await getDexagPrice(
        (await tokenInfo[order.sellToken]).symbol,
        (await tokenInfo[order.sellToken]).symbol,
        globalPriceStorage
      )
      await getDexagPrice((await tokenInfo[order.sellToken]).symbol, "USDC", globalPriceStorage)
    }

    // 1. verify that the owner of the brackets is the masterSafe
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await isOnlySafeOwner(argv.masterSafe, bracketTrader, artifacts))
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

    // 5. verify that no bracket-trader offers profitable orders
    for (const bracketTrader of bracketTraderAddresses) {
      const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)
      for (const order of relevantOrders) {
        assert.equal(
          await checkNoProfitableOffer(order, exchange, globalPriceStorage),
          true,
          `The order ${order} of the bracket ${bracketTrader} is profitable`
        )
      }
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
