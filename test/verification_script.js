const BN = require("bn.js")
const assert = require("assert")
const Contract = require("@truffle/contract")

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const EvilGnosisSafeProxy = artifacts.require("EvilGnosisSafeProxy")

const { verifyCorrectSetup } = require("../scripts/utils/verify_scripts")(web3, artifacts)
const { getUnlimitedOrderAmounts } = require("../scripts/utils/price_utils")(web3, artifacts)
const { addCustomMintableTokenToExchange, createTokenAndGetData, deploySafe } = require("./test_utils")
const { execTransaction, waitForNSeconds, ADDRESS_0 } = require("../scripts/utils/internals")(web3, artifacts)
const {
  getAllowances,
  assertNoAllowances,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromOrders,
  maxU32,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { buildExecTransaction, CALL } = require("../scripts/utils/internals")(web3, artifacts)

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
  let targetToken
  let stableToken
  let safeOwner
  beforeEach(async function () {
    safeOwner = {
      account: "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1",
      privateKey: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    }
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()

    // TODO: this is needed as fetching the orderbook on an empty orderbook throws. This can be fixed in the future
    targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
    stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
    await exchange.placeOrder(targetToken, stableToken, 1234124, 11241234, 11234234, { from: accounts[0] })
  })
  describe("Owner is master safe", async () => {
    it("throws if the masterSafe is not the only owner", async () => {
      const notMasterSafeAddress = accounts[8]
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const notOwnedBracket = await deployFleetOfSafes(notMasterSafeAddress, 1)
      await assert.rejects(verifyCorrectSetup(notOwnedBracket, masterSafe.address), {
        message: `Error: Bracket ${notOwnedBracket.address} is not owned (or at least not solely) by master safe ${masterSafe.address}`,
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
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const brackets = [(await deploySafe(notMasterCopy, proxyFactory, [masterSafe.address], 1)).toLowerCase()]
      await assert.rejects(verifyCorrectSetup(brackets, masterSafe.address), {
        message: "MasterCopy not set correctly",
      })
    })
  })
  describe("Brackets' deployed bytecode coincides with that of a Gnosis Safe proxy", async () => {
    it("throws if bytecode differs", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const evilProxy = await EvilGnosisSafeProxy.new(GnosisSafe.address)
      const evilSafe = await GnosisSafe.at(evilProxy.address)
      await evilSafe.setup([masterSafe.address], "1", ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, "0", ADDRESS_0)
      await assert.rejects(verifyCorrectSetup([evilProxy.address], masterSafe.address), {
        message: "Bad bytecode for bracket " + evilProxy.address,
      })
    })
  })
  describe("No modules are installed", async () => {
    it("throws if module is present in master", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
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
      await execTransaction(masterSafe, safeOwner.privateKey, addModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Modules present in Safe " + masterSafe.address,
      })
    })
    it("throws if module is present in bracket", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
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
      await execTransaction(masterSafe, safeOwner.privateKey, execAddModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Modules present in Safe " + bracketAddress,
      })
    })
  })
  describe("Fallback handler did not change", async () => {
    it("throws if master's fallback handler changed", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const bracket = await GnosisSafe.at(bracketAddress)
      const handlerAddress = "0x" + "2".padStart(40, "0")
      const addModuleTransaction = {
        to: masterSafe.address,
        value: 0,
        data: bracket.contract.methods.setFallbackHandler(handlerAddress).encodeABI(),
        operation: CALL,
      }
      // fallback address can only be added with a transaction from the contract to itself
      await execTransaction(masterSafe, safeOwner.privateKey, addModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Fallback handler of Safe " + masterSafe.address + " changed",
      })
    })
    it("throws if bracket's fallback handler changed", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
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
      await execTransaction(masterSafe, safeOwner.privateKey, execAddModuleTransaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Fallback handler of Safe " + bracketAddress + " changed",
      })
    })
  })
  describe("Each bracket has only two orders", async () => {
    it("throws if a bracket does not have two orders", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
      const stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
      const lowestLimit = 90
      const highestLimit = 120
      //first round of order building
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)
      // second round of order building
      const transaction2 = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address), {
        message: "order length is not correct",
      })
    })
    it("throws if orders do not buy and sell the same tokens in a loop", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const targetToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const stableToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])
      const lowestLimit = 90
      const highestLimit = 120

      // create unlimited orders to sell low and buy high
      const [upperSellAmount, upperBuyAmount] = getUnlimitedOrderAmounts(highestLimit, 18, 18)
      const [lowerBuyAmount, lowerSellAmount] = getUnlimitedOrderAmounts(lowestLimit, 18, 18)

      const validFrom = (await exchange.getCurrentBatchId.call()).toNumber() + 3
      const buyTokens = [targetToken.id, targetToken.id]
      const sellTokens = [stableToken.id, stableToken.id]
      const validFroms = [validFrom, validFrom]
      const validTos = [maxU32, maxU32]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address, []), {
        message: "The two orders are not set up to trade back and forth on the same token pair",
      })
    })
  })
  describe("The orders of a bracket are profitable to trade against each other", async () => {
    it("throws if orders of one bracket are not profitable", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddress = (await deployFleetOfSafes(masterSafe.address, 1))[0]
      const targetToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const stableToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])
      const lowestLimit = 90
      const highestLimit = 120

      // create unlimited orders to sell low and buy high
      const [upperSellAmount, upperBuyAmount] = getUnlimitedOrderAmounts(lowestLimit, 18, 18)
      const [lowerBuyAmount, lowerSellAmount] = getUnlimitedOrderAmounts(highestLimit, 18, 18)

      const validFrom = (await exchange.getCurrentBatchId.call()).toNumber() + 3
      const buyTokens = [targetToken.id, stableToken.id]
      const sellTokens = [stableToken.id, targetToken.id]
      const validFroms = [validFrom, validFrom]
      const validTos = [maxU32, maxU32]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address), {
        message: "Brackets do not gain money when trading",
      })
    })
  })
  describe("Brackets must be funded, such their orders are profitable orders for the current market price", async () => {
    it("throws if there are profitable orders", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 3)
      const targetToken = await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])
      const stableToken = await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])

      const investmentStableToken = new BN("1000000000000000000000000")
      const investmentTargetToken = new BN("1000000000000000000000000")
      await stableToken.token.mint(masterSafe.address, investmentStableToken, { from: accounts[0] })
      await targetToken.token.mint(masterSafe.address, investmentTargetToken, { from: accounts[0] })
      const lowestLimit = 90
      const highestLimit = 120
      const currentPrice = 100

      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.id,
        stableToken.id,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.token.address,
        stableToken.token.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        investmentStableToken,
        investmentTargetToken,
        true
      )
      await execTransaction(masterSafe, safeOwner.privateKey, bundledFundingTransaction)

      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      const globalPriceStorage = {}
      globalPriceStorage["DAI-USDC"] = 1.0
      globalPriceStorage["WETH-USDC"] = 1
      globalPriceStorage["DAI-WETH"] = 100 //<-- price is correct
      await verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, null, null, [], globalPriceStorage)
      await verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, null, null, [], globalPriceStorage)

      globalPriceStorage["DAI-WETH"] = 121 //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, null, null, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[1].toLowerCase()} is profitable`,
      })

      globalPriceStorage["DAI-WETH"] = 70 //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, null, null, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[0].toLowerCase()} is profitable`,
      })
    })
  })
})
