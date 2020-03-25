const BN = require("bn.js")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const ERC20 = artifacts.require("ERC20Detailed")
const TokenOWL = artifacts.require("TokenOWL")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const TestToken = artifacts.require("DetailedMintableToken")
const { prepareTokenRegistration } = require("./test-utils")
const {
  fetchTokenInfoFromExchange,
  fetchTokenInfoAtAddresses,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromList,
  buildTransferApproveDepositFromOrders,
  buildRequestWithdraw,
  buildWithdraw,
  buildTransferFundsToMaster,
  buildWithdrawAndTransferFundsToMaster,
  isOnlySafeOwner,
  max128,
  maxU32,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { waitForNSeconds, execTransaction, deploySafe } = require("../scripts/utils/internals")(web3, artifacts)
const { checkCorrectnessOfDeposits } = require("../scripts/utils/price-utils")(web3, artifacts)

const { toErc20Units } = require("../scripts/utils/printing_tools")

const TEN = new BN(10)

const checkPricesOfBracketStrategy = async function(lowestLimit, highestLimit, bracketSafes, exchange) {
  const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketSafes.length)

  // Correctness assertions
  for (const [index, bracketAddress] of bracketSafes.entries()) {
    let multiplicator = new BN("100")
    if (lowestLimit * Math.pow(stepSizeAsMultiplier, index) < 10) {
      multiplicator = new BN("1000000")
    }
    const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(bracketAddress))
    assert.equal(auctionElements.length, 2)
    const [buyOrder, sellOrder] = auctionElements
    const decimalsOfSellToken = await (await ERC20.at(await exchange.tokenIdToAddressMap.call(buyOrder.sellToken))).decimals()
    const decimalsOfBuyToken = await (await ERC20.at(await exchange.tokenIdToAddressMap.call(buyOrder.buyToken))).decimals()

    // Check buy order prices
    assert.isBelow(
      Math.abs(
        buyOrder.priceDenominator
          .mul(multiplicator)
          .mul(TEN.pow(decimalsOfBuyToken))
          .div(TEN.pow(decimalsOfSellToken))
          .div(buyOrder.priceNumerator)
          .toNumber() -
          lowestLimit * Math.pow(stepSizeAsMultiplier, index) * multiplicator.toNumber()
      ),
      2
    )
    // Check sell order prices
    assert.isBelow(
      Math.abs(
        sellOrder.priceNumerator
          .mul(multiplicator)
          .mul(TEN.pow(decimalsOfBuyToken))
          .div(TEN.pow(decimalsOfSellToken))
          .div(sellOrder.priceDenominator)
          .toNumber() -
          lowestLimit * Math.pow(stepSizeAsMultiplier, index + 1) * multiplicator.toNumber()
      ),
      2
    )
  }
}
contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange

  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    testToken = await TestToken.new("TEST", 18)

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })

  describe("Exchange interaction test:", async function() {
    it("Adds tokens to the exchange", async () => {
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })
      assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
    })
    const checkTokenInfo = async function(token, tokenInfo) {
      assert.equal((await token.decimals()).toString(), tokenInfo.decimals.toString(), "wrong number of decimals")
      assert.equal(await token.address, tokenInfo.address, "wrong address")
      assert.equal(await token.symbol(), tokenInfo.symbol, "wrong symbol")
    }
    it("Asynchronously fetches tokens at addresses", async function() {
      const token1 = await TestToken.new("TEST", 18)
      const token2 = await TestToken.new("TEST", 9)
      assert(token1.address != token2.address, "The two newly generated tokens should be different")

      const tokenInfoPromises1 = fetchTokenInfoAtAddresses([token1.address])
      const token1Info1 = await tokenInfoPromises1[token1.address]
      await checkTokenInfo(token1, token1Info1)

      const tokenInfoPromises2 = fetchTokenInfoAtAddresses([token1.address, token2.address])
      const token1Info2 = await tokenInfoPromises2[token1.address]
      const token2Info2 = await tokenInfoPromises2[token2.address]
      await checkTokenInfo(token1, token1Info2)
      await checkTokenInfo(token2, token2Info2)
    })
    it("Fetches tokens from exchange", async function() {
      const owlToken = await TokenOWL.at(await exchange.feeToken())
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })
      const tokenId = await exchange.tokenAddressToIdMap(testToken.address) // TODO: make tests independent and replace tokenId with 1

      const tokenInfoPromises1 = fetchTokenInfoFromExchange(exchange, [0])
      const token0Info1 = await tokenInfoPromises1[0]
      await checkTokenInfo(owlToken, token0Info1)

      const tokenInfoPromises2 = fetchTokenInfoFromExchange(exchange, [0, tokenId])
      const token0Info2 = await tokenInfoPromises2[0]
      const token1Info2 = await tokenInfoPromises2[tokenId]
      await checkTokenInfo(owlToken, token0Info2)
      await checkTokenInfo(testToken, token1Info2)
    })
  })
  describe("Gnosis Safe deployments:", async function() {
    it("Deploys Fleet of Gnosis Safes", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const fleet = await deployFleetOfSafes(masterSafe.address, 10)
      assert.equal(fleet.length, 10)
      for (const bracketAddress of fleet) assert(await isOnlySafeOwner(masterSafe.address, bracketAddress))
    })
  })
  describe("transfer tests:", async function() {
    it("transfers tokens from fund account through trader accounts and into exchange via manual deposit logic", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = 1000
      await testToken.mint(accounts[0], depositAmount * bracketAddresses.length)
      await testToken.transfer(masterSafe.address, depositAmount * bracketAddresses.length)
      // Note that we are have NOT registered the tokens on the exchange but we can deposit them nevertheless.

      const deposits = bracketAddresses.map(bracketAddress => ({
        amount: depositAmount.toString(),
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))

      const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)

      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be refelcted in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        const bracketExchangeBalance = (await exchange.getBalance(bracketAddress, testToken.address)).toNumber()
        assert.equal(bracketExchangeBalance, depositAmount)
        const bracketPersonalTokenBalance = (await testToken.balanceOf(bracketAddress)).toNumber()
        // This should always output 0 as the brackets should never directly hold funds
        assert.equal(bracketPersonalTokenBalance, 0)
      }
    })

    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p > 1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const fleetSize = 4
      const lowestLimit = 100
      const highestLimit = 121
      const currentPrice = 110
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, fleetSize)
      const depositAmountStableToken = new BN(1000)

      //Create  stableToken and add it to the exchange
      const stableToken = await TestToken.new("DAI", 18)
      await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(stableToken.address, { from: accounts[0] })
      const depositAmountTargetToken = new BN(2000)
      const stableTokenId = (await exchange.tokenAddressToIdMap.call(stableToken.address)).toNumber()

      //Create targetToken and add it to the exchange
      const targetToken = await TestToken.new("ETH", 18)
      await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(targetToken.address, { from: accounts[0] })
      const targetTokenId = (await exchange.tokenAddressToIdMap.call(targetToken.address)).toNumber()
      // Build orders
      const orderTransaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetTokenId,
        stableTokenId,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, orderTransaction)

      // Make transfers
      const batchTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.address,
        stableToken.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositAmountStableToken,
        depositAmountTargetToken
      )
      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        await checkCorrectnessOfDeposits(
          currentPrice,
          bracketAddress,
          exchange,
          stableToken,
          targetToken,
          depositAmountStableToken.div(new BN(2)),
          depositAmountTargetToken.div(new BN(2))
        )
      }
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p < 1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const fleetSize = 4
      const lowestLimit = 0.09
      const highestLimit = 0.12
      const currentPrice = 0.105
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, fleetSize)
      const depositAmountStableToken = new BN(1000)

      //Create  stableToken and add it to the exchange
      const stableToken = await TestToken.new("DAI", 18)
      await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(stableToken.address, { from: accounts[0] })
      const depositAmountTargetToken = new BN(2000)
      const stableTokenId = (await exchange.tokenAddressToIdMap.call(stableToken.address)).toNumber()

      //Create targetToken and add it to the exchange
      const targetToken = await TestToken.new("ETH", 18)
      await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(targetToken.address, { from: accounts[0] })
      const targetTokenId = (await exchange.tokenAddressToIdMap.call(targetToken.address)).toNumber()
      // Build orders
      const orderTransaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetTokenId,
        stableTokenId,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, orderTransaction)

      // Make transfers
      const batchTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.address,
        stableToken.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositAmountStableToken,
        depositAmountTargetToken
      )
      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        await checkCorrectnessOfDeposits(
          currentPrice,
          bracketAddress,
          exchange,
          stableToken,
          targetToken,
          depositAmountStableToken.div(new BN(2)),
          depositAmountTargetToken.div(new BN(2))
        )
      }
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p<1 && p>1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const fleetSize = 4
      const lowestLimit = 0.8
      const highestLimit = 1.2
      const currentPrice = 0.9
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, fleetSize)
      const depositAmountStableToken = new BN(1000)

      //Create  stableToken and add it to the exchange
      const stableToken = await TestToken.new("DAI", 18)
      await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(stableToken.address, { from: accounts[0] })
      const depositAmountTargetToken = new BN(2000)
      const stableTokenId = (await exchange.tokenAddressToIdMap.call(stableToken.address)).toNumber()

      //Create targetToken and add it to the exchange
      const targetToken = await TestToken.new("ETH", 18)
      await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(targetToken.address, { from: accounts[0] })
      const targetTokenId = (await exchange.tokenAddressToIdMap.call(targetToken.address)).toNumber()
      // Build orders
      const orderTransaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetTokenId,
        stableTokenId,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, orderTransaction)

      // Make transfers
      const batchTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.address,
        stableToken.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositAmountStableToken,
        depositAmountTargetToken
      )
      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        await checkCorrectnessOfDeposits(
          currentPrice,
          bracketAddress,
          exchange,
          stableToken,
          targetToken,
          depositAmountStableToken.div(new BN(1)),
          depositAmountTargetToken.div(new BN(3))
        )
      }
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic with currentPrice outside of price bounds", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const fleetSize = 4
      const lowestLimit = 0.8
      const highestLimit = 1.2
      const currentPrice = 0.7
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, fleetSize)
      const depositAmountStableToken = new BN(1000)

      //Create  stableToken and add it to the exchange
      const stableToken = await TestToken.new("DAI", 18)
      await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(stableToken.address, { from: accounts[0] })
      const depositAmountTargetToken = new BN(2000)
      const stableTokenId = (await exchange.tokenAddressToIdMap.call(stableToken.address)).toNumber()

      //Create targetToken and add it to the exchange
      const targetToken = await TestToken.new("ETH", 18)
      await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(targetToken.address, { from: accounts[0] })
      const targetTokenId = (await exchange.tokenAddressToIdMap.call(targetToken.address)).toNumber()
      // Build orders
      const orderTransaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetTokenId,
        stableTokenId,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, orderTransaction)

      // Make transfers
      const batchTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken.address,
        stableToken.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositAmountStableToken,
        depositAmountTargetToken
      )
      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        await checkCorrectnessOfDeposits(
          currentPrice,
          bracketAddress,
          exchange,
          stableToken,
          targetToken,
          0,
          depositAmountTargetToken.div(new BN(4))
        )
      }
    })
  })

  describe("bracket order placement test:", async function() {
    it("Places bracket orders on behalf of a fleet of safes and checks for profitability and validity", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 6)
      const targetToken = 0 // ETH
      const stableToken = 1 // DAI
      const lowestLimit = 90
      const highestLimit = 120
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })

      const currentBatch = (await exchange.getCurrentBatchId.call()).toNumber()
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      // Correctness assertions
      for (const bracketAddress of bracketAddresses) {
        const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements

        // Checks that bracket orders are profitable for liquidity provider
        const initialAmount = toErc20Units(1, 18)
        const amountAfterSelling = initialAmount.mul(sellOrder.priceNumerator).div(sellOrder.priceDenominator)
        const amountAfterBuying = amountAfterSelling.mul(buyOrder.priceNumerator).div(buyOrder.priceDenominator)
        assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")

        assert.equal(buyOrder.validUntil, maxU32, `Got ${sellOrder}`)
        assert.equal(sellOrder.validUntil, maxU32, `Got ${sellOrder}`)
        assert.equal(buyOrder.validFrom, currentBatch + 3)
        assert.equal(buyOrder.validFrom, currentBatch + 3)
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks price for p< 1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const targetToken = 0 // ETH
      const stableToken = 1 // DAI
      const lowestLimit = 0.09
      const highestLimit = 0.12
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(
        masterSafe.address,
        bracketSafes,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
      // Check that unlimited orders are being used
      for (const bracketAddress of bracketSafes) {
        const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(bracketAddress))
        const [buyOrder, sellOrder] = auctionElements
        assert(buyOrder.priceNumerator.eq(max128))
        assert(sellOrder.priceDenominator.eq(max128))
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const targetToken = 0 // ETH
      const stableToken = 1 // DAI
      const lowestLimit = 80
      const highestLimit = 110
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(
        masterSafe.address,
        bracketSafes,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
      // Check that unlimited orders are being used
      for (const bracketAddress of bracketSafes) {
        const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements
        assert(buyOrder.priceDenominator.eq(max128))
        assert(sellOrder.priceNumerator.eq(max128))
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p<1, with different decimals than 18", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      testToken = await TestToken.new("TEST6", 6)
      const testToken2 = await TestToken.new("TEST4", 4)
      const targetToken = 2 // "TEST4"
      const stableToken = 1 // "TEST6"
      const lowestLimit = 0.8
      const highestLimit = 1.1
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken2.address, { from: accounts[0] })
      await exchange.tokenIdToAddressMap.call(2)
      const transaction = await buildOrders(
        masterSafe.address,
        bracketSafes,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1, with different decimals than 18", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      testToken = await TestToken.new("TEST6", 6)
      const targetToken = 0 // ETH
      const stableToken = 1 // "TEST6"
      const lowestLimit = 80
      const highestLimit = 110
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(
        masterSafe.address,
        bracketSafes,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1 && p<1", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const targetToken = 0 // ETH
      const stableToken = 1 // DAI
      const lowestLimit = 0.8
      const highestLimit = 1.1
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(
        masterSafe.address,
        bracketSafes,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
  })

  describe("Test withdrawals", async function() {
    const setupAndRequestWithdraw = async function(masterSafe, bracketAddresses, deposits, withdrawals) {
      const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)

      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)
      const totalDepositedAmount = {}
      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(bracketAddress)).toString(),
          "0",
          "Balance setup failed: trader Safes still holds funds"
        )

        if (typeof totalDepositedAmount[tokenAddress] === "undefined") totalDepositedAmount[tokenAddress] = new BN(amount)
        else totalDepositedAmount[tokenAddress] = totalDepositedAmount[tokenAddress].add(new BN(amount))
      }

      for (const [tokenAddress, totalAmountForToken] of Object.entries(totalDepositedAmount)) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(masterSafe.address)).toString(),
          "0",
          "Balance setup failed: master Safe still holds funds"
        )
        assert.equal(
          (await token.balanceOf(exchange.address)).toString(),
          totalAmountForToken.toString(),
          "Balance setup failed: the exchange does not hold all tokens"
        )
      }

      const requestWithdrawalTransaction = await buildRequestWithdraw(masterSafe.address, withdrawals)
      await execTransaction(masterSafe, lw, requestWithdrawalTransaction, "request withdrawal for all brackets")
      await waitForNSeconds(301)

      const totalWithdrawnAmount = {}
      for (const { amount, tokenAddress, bracketAddress } of withdrawals) {
        const pendingWithdrawal = await exchange.getPendingWithdraw(bracketAddress, tokenAddress)
        assert.equal(pendingWithdrawal[0].toString(), amount.toString(), "Withdrawal was not registered on the exchange")

        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(bracketAddress)).toString(),
          "0",
          "Unexpected behavior in requestWithdraw: trader Safes holds funds"
        )

        totalWithdrawnAmount[tokenAddress] = (totalWithdrawnAmount[tokenAddress] || new BN(0)).add(new BN(amount))
      }

      for (const [tokenAddress, totalAmountForToken] of Object.entries(totalWithdrawnAmount)) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(masterSafe.address)).toString(),
          "0",
          "Unexpected behavior in requestWithdraw: master Safe holds funds"
        )
        assert.equal(
          (await token.balanceOf(exchange.address)).toString(),
          totalAmountForToken.toString(),
          "Unexpected behavior in requestWithdraw: the exchange does not hold all tokens"
        )
      }
    }

    it("Withdraw full amount, three steps", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = toErc20Units(200, 18)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map(bracketAddress => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map(deposit => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      // withdrawalsModified has the original withdraw amounts plus an extra. It is used to test
      // that extra amounts are ignored by the script and just the maximal possible value is withdrawn
      const withdrawalsModified = withdrawals
      withdrawalsModified.map(withdraw => {
        withdraw.amount = withdraw.amount.add(toErc20Units(1, 18))
        withdraw
      })
      const withdrawalTransaction = await buildWithdraw(masterSafe.address, withdrawalsModified)

      await execTransaction(masterSafe, lw, withdrawalTransaction, "withdraw for all brackets")

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        "0",
        "Unexpected behavior when withdrawing: master Safe holds funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Withdrawing failed: the exchange still holds all tokens"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          depositAmount.toString(),
          "Withdrawing failed: trader Safes do not hold the correct amount of funds"
        )

      // tries to transfer more funds to master than available, script should be aware of it
      const transferFundsToMasterTransaction = await buildTransferFundsToMaster(masterSafe.address, withdrawalsModified, true)

      await execTransaction(masterSafe, lw, transferFundsToMasterTransaction, "transfer funds to master for all brackets")

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        fullTokenAmount.toString(),
        "Fund retrieval failed: master Safe does not hold all funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Unexpected behavior when retrieving funds: the exchange holds funds"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          "0",
          "Fund retrieval failed: trader Safes still hold some funds"
        )
    })

    it("Withdraw full amount, two steps", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = toErc20Units(200, 18)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map(bracketAddress => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map(deposit => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      const withdrawAndTransferFundsToMasterTransaction = await buildWithdrawAndTransferFundsToMaster(
        masterSafe.address,
        withdrawals
      )
      await execTransaction(
        masterSafe,
        lw,
        withdrawAndTransferFundsToMasterTransaction,
        "withdraw and transfer back for all brackets"
      )

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        fullTokenAmount.toString(),
        "Fund retrieval failed: master Safe does not hold all funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Unexpected behavior when retrieving funds: the exchange holds funds"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          "0",
          "Fund retrieval failed: trader Safes still hold some funds"
        )
    })
  })
})
