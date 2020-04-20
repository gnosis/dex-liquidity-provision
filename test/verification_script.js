const BN = require("bn.js")
const assert = require("assert")
const Contract = require("@truffle/contract")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")

const { verifyCorrectSetup } = require("../scripts/utils/verify_scripts")(web3, artifacts)
const { getUnlimitedOrderAmounts } = require("../scripts/utils/price_utils")(web3, artifacts)
const { addCustomMintableTokenToExchange, createTokenAndGetData, deploySafe } = require("./test_utils")
const { execTransaction, waitForNSeconds } = require("../scripts/utils/internals")(web3, artifacts)
const {
  getAllowances,
  assertNoAllowances,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromOrders,
  maxU32,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { buildExecTransaction, CALL } = require("../scripts/utils/internals")(web3, artifacts)

contract("verification checks - for allowances", async accounts => {
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

contract("Verification checks", function(accounts) {
  let exchange
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let targetToken
  let stableToken
  beforeEach(async function() {
    // Create lightwallet
    lw = await utils.createLightwallet()

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
  describe("1 Check: Owner is master safe", async () => {
    it("throws if the masterSafe is not the only owner", async () => {
      const notMasterSafeAddress = accounts[8]
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const notOwnedBracket = await deployFleetOfSafes(notMasterSafeAddress, 1)
      await assert.rejects(verifyCorrectSetup(notOwnedBracket, masterSafe.address, []), {
        message: "Owners are not set correctly",
      })
    })
  })
  describe("2 Check: MasterCopy is usual GnosisSafeMasterCopy", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {
      const notMasterCopy = await GnosisSafe.new()
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const brackets = [(await deploySafe(notMasterCopy, proxyFactory, [masterSafe.address], 1)).toLowerCase()]
      await assert.rejects(verifyCorrectSetup(brackets, masterSafe.address, []), {
        message: "MasterCopy not set correctly",
      })
    })
  })
  describe("3 Check: Each bracket has only two orders", async () => {
    it("throws if a bracket does not have two orders", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
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
      await execTransaction(masterSafe, lw, transaction)
      // second round of order building
      const transaction2 = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction2)
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, []), {
        message: "order length is not correct",
      })
    })
  })
  describe("4 Check: The orders of a bracket are profitable to trade against each other", async () => {
    it("throws if orders of one bracket are not profitable", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
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
      await execTransaction(masterSafe, lw, transaction)
      await assert.rejects(verifyCorrectSetup([bracketAddress], masterSafe.address, []), {
        message: "Brackets are not profitable",
      })
    })
  })
  describe("5 Check: Brackets must be funded, such their orders are profitable orders for the current market price", async () => {
    it("throws if there are profitable orders", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
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
      await execTransaction(masterSafe, lw, transaction)

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
      await execTransaction(masterSafe, lw, bundledFundingTransaction)

      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      const globalPriceStorage = {}
      globalPriceStorage["DAI-USDC"] = 1.0
      globalPriceStorage["WETH-USDC"] = 1
      globalPriceStorage["DAI-WETH"] = 100 //<-- price is correct
      await verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, [], globalPriceStorage)
      await verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, [], globalPriceStorage)

      globalPriceStorage["DAI-WETH"] = 121 //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[1]], masterSafe.address, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[1].toLowerCase()} is profitable`,
      })

      globalPriceStorage["DAI-WETH"] = 70 //<-- price is off, hence orders are profitable
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, [], globalPriceStorage), {
        message: `The order of the bracket ${bracketAddresses[0].toLowerCase()} is profitable`,
      })
    })
  })
})
