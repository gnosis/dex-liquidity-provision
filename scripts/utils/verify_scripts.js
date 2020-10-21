module.exports = function (web3 = web3, artifacts = artifacts) {
  const assert = require("assert")
  const { decodeOrders, Fraction } = require("@gnosis.pm/dex-contracts")

  const { isOnlySafeOwner, fetchTokenInfoFromExchange, assertNoAllowances, getSafe } = require("./trading_strategy_helpers")(
    web3,
    artifacts
  )
  const { getMasterCopy, getFallbackHandler } = require("./internals")(web3, artifacts)
  const { getOneinchPrice, checkNoProfitableOffer } = require("./price_utils")
  const { BatchExchange, GnosisSafe, GnosisSafeProxyFactory } = require("./dependencies")(web3, artifacts)

  const gnosisSafeMasterCopy = GnosisSafe.deployed()
  const expectedBytecodePromise = GnosisSafeProxyFactory.deployed().then((proxyFactory) => proxyFactory.proxyRuntimeCode())

  const verifyBracketsWellFormed = async function (
    masterAddress,
    bracketAddresses,
    masterThreshold = null,
    masterOwners = null,
    logActivated = false
  ) {
    const log = logActivated ? (...a) => console.log(...a) : () => {}

    const gnosisSafe = await gnosisSafeMasterCopy
    const master = await getSafe(masterAddress)
    const brackets = await Promise.all(bracketAddresses.map((bracketAddress) => getSafe(bracketAddress)))

    log("- Verify that all brackets are Gnosis Safes")
    await Promise.all(
      bracketAddresses.map(async (bracketAddress) => {
        assert.equal(
          await web3.eth.getCode(bracketAddress),
          await expectedBytecodePromise,
          `Bytecode at bracket ${bracketAddress} does not agree with that of a Gnosis Safe Proxy v1.1.1`
        )
      })
    )

    if (!masterOwners || !masterThreshold) log("Warning: master safe owner verification skipped")
    else {
      log("- Verify owners of masterSafe")
      const threshold = master.getThreshold()
      const owners = master.getOwners()
      assert.equal(
        await threshold,
        masterThreshold,
        "Master threshold is " + (await threshold) + " while it is supposed to be " + masterThreshold
      )
      assert.deepStrictEqual(
        (await owners).slice().sort(),
        masterOwners.slice().sort(),
        "Master owners are different than expected"
      )
    }

    log("- Verify that brackets are owned solely by masterSafe")
    await Promise.all(
      brackets.map(async (bracketTrader) => {
        assert(
          await isOnlySafeOwner(masterAddress, bracketTrader),
          `Error: Bracket ${bracketTrader.address} is not owned (or at least not solely) by master safe ${masterAddress}`
        )
      })
    )

    log("- Verify that masterCopy of brackets is the known masterCopy")
    await Promise.all(
      bracketAddresses.map(async (addr) => {
        assert.equal(
          (await getMasterCopy(addr)).toString().toLowerCase(),
          gnosisSafe.address.toString().toLowerCase(),
          "MasterCopy not set correctly"
        )
      })
    )

    log("- Verify absence of modules")
    await Promise.all(
      brackets.concat(master).map(async (safe) => {
        assert.strictEqual((await safe.getModules()).length, 0, "Modules present in Safe " + safe.address)
      })
    )

    log("- Verify unchanged fallback handler")
    const defaultFallbackHandler = getFallbackHandler(GnosisSafe.address)
    await Promise.all(
      //Todo: additionally the fallback handler of the masterAddress could be checked .concat(masterAddress)
      bracketAddresses.map(async (safeAddress) => {
        assert.strictEqual(
          await getFallbackHandler(safeAddress),
          await defaultFallbackHandler,
          "Fallback handler of Safe " + safeAddress + " changed"
        )
      })
    )
  }

  const verifyCorrectSetup = async function (
    brackets,
    masterSafe,
    masterThreshold = null,
    masterOwners = null,
    allowanceExceptions = [],
    globalPriceStorage = {},
    logActivated = false
  ) {
    const log = logActivated ? (...a) => console.log(...a) : () => {}

    const bracketTraderAddresses = brackets.map((address) => address.toLowerCase())
    const exchange = await BatchExchange.deployed()

    // Fetch all token infos(decimals, symbols etc) and prices upfront for the following verification
    const ordersObjects = await Promise.all(
      bracketTraderAddresses.map(async (bracketAddress) =>
        decodeOrders(await exchange.getEncodedUserOrders.call(bracketAddress))
      )
    )
    const relevantOrders = [].concat(...ordersObjects)

    const tradedTokenIds = new Set()
    for (const order of relevantOrders) {
      tradedTokenIds.add(order.sellToken)
      tradedTokenIds.add(order.buyToken)
    }
    const tokenInfo = fetchTokenInfoFromExchange(exchange, Array.from(tradedTokenIds))

    // update globalPriceStorage to include all tokens involved in an order and those needed to compute USD prices
    for (const order of relevantOrders) {
      await getOneinchPrice(await tokenInfo[order.sellToken], await tokenInfo[order.buyToken], globalPriceStorage)
      await getOneinchPrice(await tokenInfo[order.sellToken], { symbol: "USDC", decimals: 6 }, globalPriceStorage)
    }

    await verifyBracketsWellFormed(masterSafe, brackets, masterThreshold, masterOwners, logActivated)

    log("- Verify that orders are set up correctly")
    for (const bracketTrader of bracketTraderAddresses) {
      const ownedOrders = relevantOrders.filter((order) => order.user.toLowerCase() == bracketTrader)
      assert(ownedOrders.length == 2, "order length is not correct")

      assert(
        ownedOrders[0].buyToken === ownedOrders[1].sellToken && ownedOrders[0].sellToken === ownedOrders[1].buyToken,
        "The two orders are not set up to trade back and forth on the same token pair"
      )
    }

    log("- Verify that each bracket can not lose tokens by selling and buying consecutively via their two orders")
    for (const bracketTrader of bracketTraderAddresses) {
      const ownedOrders = relevantOrders.filter((order) => order.user.toLowerCase() == bracketTrader)
      const sellOrderPrice = new Fraction(ownedOrders[0].priceNumerator, ownedOrders[0].priceDenominator)
      const buyOrderPrice = new Fraction(ownedOrders[1].priceNumerator, ownedOrders[1].priceDenominator)
      const one = new Fraction(1, 1)
      assert(sellOrderPrice.mul(buyOrderPrice).gt(one), "Brackets do not gain money when trading")
    }

    log("- Verify that no bracket-trader offers profitable orders")
    for (const order of relevantOrders) {
      assert(
        await checkNoProfitableOffer(order, tokenInfo, globalPriceStorage),
        `The order of the bracket ${order.user} is profitable`
      )
    }

    log("- Verify that no allowances are currently set")
    await assertNoAllowances(masterSafe, tokenInfo, allowanceExceptions)
    for (const bracketTrader of bracketTraderAddresses) await assertNoAllowances(bracketTrader, tokenInfo)
  }

  return {
    verifyCorrectSetup,
    verifyBracketsWellFormed,
  }
}
