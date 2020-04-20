module.exports = function(web3 = web3, artifacts = artifacts) {
  const assert = require("assert")
  const Contract = require("@truffle/contract")
  const { getOrdersPaginated } = require("@gnosis.pm/dex-contracts/src/onchain_reading")
  const { Fraction } = require("@gnosis.pm/dex-contracts/src")

  const { isOnlySafeOwner, fetchTokenInfoFromExchange, assertNoAllowances } = require("./trading_strategy_helpers")(
    web3,
    artifacts
  )
  const { getMasterCopy } = require("./internals")(web3, artifacts)
  const { getDexagPrice, checkNoProfitableOffer } = require("./price_utils")(web3, artifacts)

  const pageSize = 50

  const verifyCorrectSetup = async function(
    brackets,
    masterSafe,
    allowanceExceptions,
    globalPriceStorage = {},
    logActivated = false
  ) {
    const log = logActivated ? (...a) => console.log(...a) : () => {}

    const BatchExchangeArtifact = require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
    const networkId = await web3.eth.net.getId()
    const BatchExchange = new web3.eth.Contract(BatchExchangeArtifact.abi, BatchExchangeArtifact.networks[networkId].address)

    const auctionElementsDecoded = await getOrdersPaginated(BatchExchange, pageSize)
    const bracketTraderAddresses = brackets.map(address => address.toLowerCase())

    const GnosisSafe = artifacts.require("GnosisSafe")
    const gnosisSafe = await GnosisSafe.deployed()

    // Fetch all token infos(decimals, symbols etc) and prices upfront for the following verification
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

    log("1. Verify that the owner of the brackets is the masterSafe")
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert(await isOnlySafeOwner(masterSafe, bracketTrader), "Owners are not set correctly")
      })
    )

    log("2. Verify that masterCopy of brackets is the known masterCopy")
    await Promise.all(
      bracketTraderAddresses.map(async bracketTrader => {
        assert.equal(
          (await getMasterCopy(bracketTrader)).toString().toLowerCase(),
          gnosisSafe.address.toString().toLowerCase(),
          "MasterCopy not set correctly"
        )
      })
    )

    log("3. Verify that orders are set up correctly")
    for (const bracketTrader of bracketTraderAddresses) {
      const ownedOrders = relevantOrders.filter(order => order.user.toLowerCase() == bracketTrader)
      assert(ownedOrders.length == 2, "order length is not correct")

      assert(
        ownedOrders[0].buyToken === ownedOrders[1].sellToken && ownedOrders[0].sellToken === ownedOrders[1].buyToken,
        "The two orders are not set up to trade back and forth on the same token pair"
      )
    }

    log("4. Verify that each bracket can not lose tokens by selling and buying consecutively via their two orders")
    for (const bracketTrader of bracketTraderAddresses) {
      const ownedOrders = relevantOrders.filter(order => order.user.toLowerCase() == bracketTrader)
      const sellOrderPrice = new Fraction(ownedOrders[0].priceNumerator, ownedOrders[0].priceDenominator)
      const buyOrderPrice = new Fraction(ownedOrders[1].priceNumerator, ownedOrders[1].priceDenominator)
      const one = new Fraction(1, 1)
      assert(sellOrderPrice.mul(buyOrderPrice).gt(one), "Brackets do not gain money when trading")
    }

    log("5. Verify that no bracket-trader offers profitable orders")
    for (const order of relevantOrders) {
      assert(
        await checkNoProfitableOffer(order, exchange, tokenInfo, globalPriceStorage),
        `The order of the bracket ${order.user} is profitable`
      )
    }

    log("6. Verify that no allowances are currently set")
    await assertNoAllowances(masterSafe, tokenInfo, allowanceExceptions)
    for (const bracketTrader of bracketTraderAddresses) await assertNoAllowances(bracketTrader, tokenInfo)
  }

  return {
    verifyCorrectSetup,
  }
}
