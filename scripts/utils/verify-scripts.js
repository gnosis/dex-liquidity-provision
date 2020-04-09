module.exports = function(web3 = web3, artifacts = artifacts) {
  const { getOrdersPaginated } = require("@gnosis.pm/dex-contracts/src/onchain_reading")
  const Contract = require("@truffle/contract")

  const { isOnlySafeOwner, fetchTokenInfoFromExchange, assertNoAllowances } = require("./trading_strategy_helpers")(
    web3,
    artifacts
  )
  const { getMasterCopy } = require("./internals")(web3, artifacts)
  const { toErc20Units } = require("./printing_tools")
  const { getDexagPrice } = require("./price-utils")(web3, artifacts)
  const { checkNoProfitableOffer } = require("./price-utils")(web3, artifacts)
  const pageSize = 50
  const assert = require("assert")

  const verifyCorrectSetup = async function(brackets, masterSafe, allowanceExceptions, globalPriceStorage = {}) {
    const BatchExchangeArtifact = require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
    const networkId = await web3.eth.net.getId()
    const BatchExchange = new web3.eth.Contract(BatchExchangeArtifact.abi, BatchExchangeArtifact.networks[networkId].address)

    const auctionElementsDecoded = await getOrdersPaginated(BatchExchange, pageSize)
    const bracketTraderAddresses = brackets.map(address => address.toLowerCase())

    // fetch all token infos(decimals, symbols etc) and prices upfront for the following verification
    const relevantOrders = auctionElementsDecoded.filter(order => bracketTraderAddresses.includes(order.user.toLowerCase()))
    const BatchExchangeContract = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchangeContract.setNetwork(web3.network_id)
    BatchExchangeContract.setProvider(web3.currentProvider)
    const exchange = await BatchExchangeContract.deployed()

    const tradedTokenIds = new Set()
    for (const order of relevantOrders) {
      tradedTokenIds.add(order.sellToken)
      tradedTokenIds.add(order.buyToken)
    }
    const tokenInfo = fetchTokenInfoFromExchange(exchange, Array.from(tradedTokenIds))

    for (const order of relevantOrders) {
      await getDexagPrice(
        (await tokenInfo[order.sellToken]).symbol,
        (await tokenInfo[order.buyToken]).symbol,
        globalPriceStorage
      )
      await getDexagPrice((await tokenInfo[order.sellToken]).symbol, "USDC", globalPriceStorage)
    }

    // 1. verify that the owner of the brackets is the masterSafe
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await isOnlySafeOwner(masterSafe, bracketTrader, artifacts), "owners are not set correctly")
      })
    )

    // 2. verify that all proxies of the brackets are pointing to the right gnosis-safe proxy:
    const GnosisSafe = artifacts.require("GnosisSafe")
    const gnosisSafe = await GnosisSafe.deployed()
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await getMasterCopy(bracketTrader), gnosisSafe.address, "MasterCopy not set correctly")
      })
    )

    // 3. verify that each bracket has only two orders
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        const relevantOrders = auctionElementsDecoded.filter(order => order.user.toLowerCase() == bracketTrader)
        assert(relevantOrders.length == 2, "order length is not correct")
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

    // 6. verify that no allowances are currently set
    await assertNoAllowances(masterSafe, tokenInfo, allowanceExceptions)
    // TODO: test if following line can be parallelized with Infura
    for (const bracketTrader of bracketTraderAddresses) await assertNoAllowances(bracketTrader, tokenInfo)
  }

  return {
    verifyCorrectSetup,
  }
}
