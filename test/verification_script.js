const BN = require("bn.js")
const assert = require("assert")
const { getUnlimitedOrderAmounts } = require("@gnosis.pm/dex-contracts")

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const EvilGnosisSafeProxy = artifacts.require("EvilGnosisSafeProxy")

const { verifyCorrectSetup } = require("../scripts/utils/verify_scripts")(web3, artifacts)
const { addCustomMintableTokenToExchange, deploySafe } = require("../scripts/utils/strategy_simulator")(web3, artifacts)
const { createTokenAndGetData, populatePriceStorage } = require("./test_utils")
const { execTransaction, waitForNSeconds } = require("../scripts/utils/internals")(web3, artifacts)
const {
  getAllowances,
  assertNoAllowances,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromOrders,
  isOnlySafeOwner,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { buildExecTransaction } = require("../scripts/utils/internals")(web3, artifacts)
const { DEFAULT_ORDER_EXPIRY, CALL, ZERO_ADDRESS } = require("../scripts/utils/constants")

contract("verification checks - for allowances", async (accounts) => {
  describe("allowances", async () => {
    let tokenInfo

    beforeEach(async () => {
      tokenInfo = {}
      const newTokens = [
        { symbol: "TEST1", decimals: 1 },
        { symbol: "TEST2", decimals: 6 },
      ]
      for (const { symbol, decimals } of newTokens) {
        const { address, tokenData } = await createTokenAndGetData(symbol, decimals)
        tokenInfo[address] = tokenData
      }
    })

    it("are found", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "100"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      const allowances = await getAllowances(owner, tokenInfo)
      const tokenAllowances = allowances[allowedTokenAddress]
      assert.equal(Object.keys(tokenAllowances).length, 1, "There should be exactly one allowance set")
      assert.equal(tokenAllowances[spender].toString(), amount, "The allowance amount is incorrect")
    })
    it("are up to date", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amountOld = "100"
      const amountNew = "200"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amountOld, { from: owner })
      await token.approve(spender, amountNew, { from: owner })
      const allowances = await getAllowances(owner, tokenInfo)
      const tokenAllowances = allowances[allowedTokenAddress]
      assert.equal(Object.keys(tokenAllowances).length, 1, "There should be exactly one allowance set")
      assert.equal(tokenAllowances[spender].toString(), amountNew, "The allowance amount is incorrect")
    })
    it("do not trigger assertion if all zero", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "0"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      await assertNoAllowances(owner, tokenInfo)
    })
    it("trigger assertion if nonzero", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "100"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      await assert.rejects(assertNoAllowances(owner, tokenInfo), {
        message:
          owner +
          " allows address " +
          spender +
          " to spend " +
          "TEST1" +
          " (amount: " +
          "10" + // token has 1 decimal
          ")",
      })
    })
    it("do not trigger assertion if address is an exception", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "100"
      const exceptions = [spender]
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      await assertNoAllowances(owner, tokenInfo, exceptions)
    })
  })
})

contract("Verification checks", function (accounts) {
  let exchange
  let gnosisSafeMasterCopy
  let proxyFactory
  let baseToken
  let quoteToken
  let safeOwner
  beforeEach(async function () {
    safeOwner = accounts[0]
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    const BatchExchange = artifacts.require("BatchExchange")
    exchange = await BatchExchange.deployed()

    // TODO: this is needed as fetching the orderbook on an empty orderbook throws. This can be fixed in the future
    baseToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
    quoteToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
    await exchange.placeOrder(baseToken, quoteToken, 1234124, 11241234, 11234234, { from: accounts[0] })
  })
  describe("isOnlySafeOwner", async function () {
    it("is successful if owner address is lowercase", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const [bracketAddress] = await deployFleetOfSafes(masterSafe.address, 1)
      assert(await isOnlySafeOwner(masterSafe.address.toLowerCase(), bracketAddress))
    })
  })
  describe("Owner is master safe", async () => {
    it("throws if the masterSafe is not the only owner", async () => {
      const notMasterSafeAddress = accounts[8]
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const notOwnedBracket = await deployFleetOfSafes(notMasterSafeAddress, 1)
      await assert.rejects(verifyCorrectSetup(notOwnedBracket, masterSafe.address), {
        message: `Error: Bracket ${notOwnedBracket} is not owned (or at least not solely) by master safe ${masterSafe.address}`,
      })
    })
  })
  describe("Master safe has specified owners", async () => {
    it("throws if the masterSafe has different threshold", async () => {
      const owners = [accounts[0], accounts[1]]
      const realThreshold = 2
      const fakeThreshold = 1
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, owners, realThreshold))
      await assert.rejects(verifyCorrectSetup([], masterSafe.address, fakeThreshold, owners), {
        message: "Master threshold is " + realThreshold + " while it is supposed to be " + fakeThreshold,
      })
    })
    it("throws if the masterSafe has different owners", async () => {
      const realOwners = [accounts[0], accounts[1]]
      const fakeOwners = [accounts[0], accounts[2]]
      const threshold = 2
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, realOwners, threshold))
      await assert.rejects(verifyCorrectSetup([], masterSafe.address, threshold, fakeOwners), {
        message: "Master owners are different than expected",
      })
    })
  })
  describe("MasterCopy is usual GnosisSafeMasterCopy", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {
      const notMasterCopy = await GnosisSafe.new()
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const brackets = [(await deploySafe(notMasterCopy, proxyFactory, [masterSafe.address], 1)).toLowerCase()]
      await assert.rejects(verifyCorrectSetup(brackets, masterSafe.address), {
        message: "MasterCopy not set correctly",
      })
    })
  })
  describe("Brackets' deployed bytecode coincides with that of a Gnosis Safe proxy", async () => {
    it("throws if bytecode differs", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const evilProxy = await EvilGnosisSafeProxy.new(GnosisSafe.address)
      const evilSafe = await GnosisSafe.at(evilProxy.address)
      await evilSafe.setup([masterSafe.address], "1", ZERO_ADDRESS, "0x", ZERO_ADDRESS, ZERO_ADDRESS, "0", ZERO_ADDRESS)
      await assert.rejects(verifyCorrectSetup([evilProxy.address], masterSafe.address), {
        message: `Bytecode at bracket ${evilProxy.address} does not agree with that of a Gnosis Safe Proxy v1.1.1`,
      })
    })
  })
  describe("No modules are installed", async () => {
    it("throws if module is present in master", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const bracket = await GnosisSafe.at(bracketAddress)
      const moduleAddress = "0x" + "2".padStart(40, "0")
      const addModuleTransaction = {
        to: masterSafe.address,
        value: 0,
        data: bracket.contract.methods.enableModule(moduleAddress).encodeABI(),
        operation: CALL,
      }
      // modules can only be added with a transaction from the contract to itself
      await execTransaction(masterSafe, safeOwner, addModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Modules present in Safe " + masterSafe.address,
      })
    })
    it("throws if module is present in bracket", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const bracket = await GnosisSafe.at(bracketAddress)
      const moduleAddress = "0x" + "2".padStart(40, "0")
      const addModuleTransaction = {
        to: bracketAddress,
        value: 0,
        data: bracket.contract.methods.enableModule(moduleAddress).encodeABI(),
        operation: CALL,
      }
      const execAddModuleTransaction = await buildExecTransaction(masterSafe.address, bracketAddress, addModuleTransaction)
      await execTransaction(masterSafe, safeOwner, execAddModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Modules present in Safe " + bracketAddress,
      })
    })
  })
  describe("Fallback handler did not change", async () => {
    // it("throws if master's fallback handler changed", async () => {
    //   const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
    //   const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
    //   const bracket = await GnosisSafe.at(bracketAddress)
    //   const handlerAddress = "0x" + "2".padStart(40, "0")
    //   const addModuleTransaction = {
    //     to: masterSafe.address,
    //     value: 0,
    //     data: bracket.contract.methods.setFallbackHandler(handlerAddress).encodeABI(),
    //     operation: CALL,
    //   }
    //   // fallback address can only be added with a transaction from the contract to itself
    //   await execTransaction(masterSafe, safeOwner, addModuleTransaction)
    //   await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
    //     message: "Fallback handler of Safe " + masterSafe.address + " changed",
    //   })
    // })
    it("throws if bracket's fallback handler changed", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const bracket = await GnosisSafe.at(bracketAddress)
      const handlerAddress = "0x" + "2".padStart(40, "0")
      const addModuleTransaction = {
        to: bracketAddress,
        value: 0,
        data: bracket.contract.methods.setFallbackHandler(handlerAddress).encodeABI(),
        operation: CALL,
      }
      const execAddModuleTransaction = await buildExecTransaction(masterSafe.address, bracketAddress, addModuleTransaction)
      await execTransaction(masterSafe, safeOwner, execAddModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Fallback handler of Safe " + bracketAddress + " changed",
      })
    })
  })
  describe("Each bracket has only two orders", async () => {
    it("throws if a bracket does not have two orders", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)

      // check that order length is not 2, since it is zero
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address), {
        message: "order length is not correct",
      })
    })
    it("throws if orders do not buy and sell the same tokens in a loop", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const baseToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const quoteToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])
      const lowestLimit = 90
      const highestLimit = 120

      // create unlimited orders to sell low and buy high
      const { base: upperSellAmount, quote: upperBuyAmount } = getUnlimitedOrderAmounts(highestLimit, 18, 18)
      const { base: lowerSellAmount, quote: lowerBuyAmount } = getUnlimitedOrderAmounts(1 / lowestLimit, 18, 18)

      const validFrom = (await exchange.getCurrentBatchId.call()).toNumber() + 3
      const buyTokens = [baseToken.id, baseToken.id]
      const sellTokens = [quoteToken.id, quoteToken.id]
      const validFroms = [validFrom, validFrom]
      const validTos = [DEFAULT_ORDER_EXPIRY, DEFAULT_ORDER_EXPIRY]
      const buyAmounts = [lowerBuyAmount.toString(), upperBuyAmount.toString()]
      const sellAmounts = [lowerSellAmount.toString(), upperSellAmount.toString()]

      const orderData = exchange.contract.methods
        .placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts)
        .encodeABI()
      const orderTransaction = {
        operation: CALL,
        to: exchange.address,
        value: 0,
        data: orderData,
      }

      const transaction = await buildExecTransaction(masterSafe.address, bracketAddress, orderTransaction)
      await execTransaction(masterSafe, safeOwner, transaction)
      const globalPriceStorage = populatePriceStorage("WETH", "DAI")
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address, null, null, [], globalPriceStorage), {
        message: "The two orders are not set up to trade back and forth on the same token pair",
      })
    })
  })
  describe("The orders of a bracket are profitable to trade against each other", async () => {
    it("throws if orders of one bracket are not profitable", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const baseToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const quoteToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])
      const lowestLimit = 90
      const highestLimit = 120

      // create unlimited orders to sell low and buy high
      const { base: upperSellAmount, quote: upperBuyAmount } = getUnlimitedOrderAmounts(lowestLimit, 18, 18)
      const { base: lowerSellAmount, quote: lowerBuyAmount } = getUnlimitedOrderAmounts(1 / highestLimit, 18, 18)

      const validFrom = (await exchange.getCurrentBatchId.call()).toNumber() + 3
      const buyTokens = [baseToken.id, quoteToken.id]
      const sellTokens = [quoteToken.id, baseToken.id]
      const validFroms = [validFrom, validFrom]
      const validTos = [DEFAULT_ORDER_EXPIRY, DEFAULT_ORDER_EXPIRY]
      const buyAmounts = [lowerBuyAmount.toString(), upperBuyAmount.toString()]
      const sellAmounts = [lowerSellAmount.toString(), upperSellAmount.toString()]

      const orderData = exchange.contract.methods
        .placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts)
        .encodeABI()
      const orderTransaction = {
        operation: CALL,
        to: exchange.address,
        value: 0,
        data: orderData,
      }
      const transaction = await buildExecTransaction(masterSafe.address, bracketAddress, orderTransaction)
      await execTransaction(masterSafe, safeOwner, transaction)
      const globalPriceStorage = populatePriceStorage("WETH", "DAI")
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address, null, null, [], globalPriceStorage), {
        message: "Brackets do not gain money when trading",
      })
    })
  })
  describe("Brackets must be funded, such their orders are profitable orders for the current market price", async () => {
    it("throws if there are profitable orders", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 3)
      const baseToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const quoteToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])

      const depositQuoteToken = new BN("1000000000000000000000000")
      const depositBaseToken = new BN("1000000000000000000000000")
      await quoteToken.token.mint(masterSafe.address, depositQuoteToken, { from: accounts[0] })
      await baseToken.token.mint(masterSafe.address, depositBaseToken, { from: accounts[0] })
      const lowestLimit = 90
      const highestLimit = 120
      const currentPrice = 100

      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken.id,
        quoteToken.id,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner, transaction)

      const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken.token.address,
        quoteToken.token.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositQuoteToken,
        depositBaseToken,
        true
      )
      await execTransaction(masterSafe, safeOwner, bundledFundingTransaction)

      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      const globalPriceStorage = {}
      globalPriceStorage["DAI-USDC"] = { price: 1.0 }
      globalPriceStorage["WETH-USDC"] = { price: 1 }
      globalPriceStorage["WETH-DAI"] = { price: 100 } //<-- price is correct
      await verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, null, null, [], globalPriceStorage)
      await verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, null, null, [], globalPriceStorage)

      globalPriceStorage["WETH-DAI"] = { price: 121 } //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, null, null, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[1].toLowerCase()} is profitable`,
      })

      globalPriceStorage["WETH-DAI"] = { price: 70 } //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, null, null, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[0].toLowerCase()} is profitable`,
      })
    })
  })
})
