const BN = require("bn.js")
const assertNodejs = require("assert")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")

const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const ERC20 = artifacts.require("ERC20Detailed")
const TokenOWL = artifacts.require("TokenOWL")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const TestToken = artifacts.require("DetailedMintableToken")

const { prepareTokenRegistration, addCustomMintableTokenToExchange, deploySafe } = require("./test_utils")
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
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { waitForNSeconds, execTransaction } = require("../scripts/utils/internals")(web3, artifacts)
const { checkCorrectnessOfDeposits } = require("../scripts/utils/price_utils")(web3, artifacts)
const { toErc20Units, fromErc20Units } = require("../scripts/utils/printing_tools")
const { DEFAULT_ORDER_EXPIRY, TEN, MAXUINT128 } = require("../scripts/utils/constants")

const checkPricesOfBracketStrategy = async function (lowestLimit, highestLimit, bracketSafes, exchange) {
  const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketSafes.length)
  const multiplicator = new BN("100000000")

  // Correctness assertions
  for (const [index, bracketAddress] of bracketSafes.entries()) {
    const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
    assert.equal(auctionElements.length, 2)
    const [buyOrder, sellOrder] = auctionElements
    const decimalsOfSellToken = await (await ERC20.at(await exchange.tokenIdToAddressMap.call(buyOrder.sellToken))).decimals()
    const decimalsOfBuyToken = await (await ERC20.at(await exchange.tokenIdToAddressMap.call(buyOrder.buyToken))).decimals()

    // Check buy order prices
    assert.isBelow(
      buyOrder.priceDenominator
        .mul(multiplicator)
        .mul(TEN.pow(decimalsOfBuyToken))
        .div(TEN.pow(decimalsOfSellToken))
        .div(buyOrder.priceNumerator)
        .sub(new BN(lowestLimit * Math.pow(stepSizeAsMultiplier, index) * multiplicator))
        .abs()
        .toNumber(),
      2
    )
    // Check sell order prices
    assert.isBelow(
      sellOrder.priceNumerator
        .mul(multiplicator)
        .mul(TEN.pow(decimalsOfBuyToken))
        .div(TEN.pow(decimalsOfSellToken))
        .div(sellOrder.priceDenominator)
        .sub(new BN(lowestLimit * Math.pow(stepSizeAsMultiplier, index + 1) * multiplicator))
        .abs()
        .toNumber(),
      2
    )
  }
}
contract("GnosisSafe", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange
  let safeOwner

  beforeEach(async function () {
    safeOwner = {
      account: "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1",
      privateKey: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    }
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    testToken = await TestToken.new("TEST", 18)

    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })

  describe("Exchange interaction test:", async function () {
    it("Adds tokens to the exchange", async () => {
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })
      assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
    })
    const checkTokenInfo = async function (token, tokenInfo) {
      assert.equal((await token.decimals()).toString(), tokenInfo.decimals.toString(), "wrong number of decimals")
      assert.equal(await token.address, tokenInfo.address, "wrong address")
      assert.equal(await token.symbol(), tokenInfo.symbol, "wrong symbol")
    }
    it("Asynchronously fetches tokens at addresses", async function () {
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
    it("Fetches tokens from exchange", async function () {
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
  describe("Gnosis Safe deployments:", async function () {
    it("Deploys Fleet of Gnosis Safes", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const fleet = await deployFleetOfSafes(masterSafe.address, 10)
      assert.equal(fleet.length, 10)
      for (const bracketAddress of fleet) assert(await isOnlySafeOwner(masterSafe.address, bracketAddress))
    })
  })
  describe("transfer tests:", async function () {
    const testManualDeposits = async function (tokenDecimals, readableDepositAmount) {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = toErc20Units(readableDepositAmount, tokenDecimals)
      const totalTokenNeeded = depositAmount.muln(bracketAddresses.length)
      const token = await TestToken.new("TEST", tokenDecimals)
      await token.mint(accounts[0], totalTokenNeeded)
      await token.transfer(masterSafe.address, totalTokenNeeded)
      // Note that we are have NOT registered the tokens on the exchange but we can deposit them nevertheless.

      const deposits = bracketAddresses.map((bracketAddress) => ({
        amount: depositAmount.toString(),
        tokenAddress: token.address,
        bracketAddress: bracketAddress,
      }))

      const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)

      await execTransaction(masterSafe, safeOwner.privateKey, batchTransaction)
      // Close auction for deposits to be refelcted in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        const bracketExchangeBalance = await exchange.getBalance(bracketAddress, token.address)
        const bracketExchangeReadableBalance = fromErc20Units(bracketExchangeBalance, tokenDecimals)
        assert.equal(bracketExchangeBalance.toString(), depositAmount.toString())
        assert.equal(bracketExchangeReadableBalance, readableDepositAmount)
        const bracketPersonalTokenBalance = (await token.balanceOf(bracketAddress)).toNumber()
        // This should always output 0 as the brackets should never directly hold funds
        assert.equal(bracketPersonalTokenBalance, 0)
      }
    }
    it("transfers tokens from fund account through trader accounts and into exchange via manual deposit logic", async () => {
      const decimals = 18
      const amount = "0.000000000000001"
      await testManualDeposits(decimals, amount)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via manual deposit logic with arbitrary number of decimals", async () => {
      const testEntries = [
        { decimals: 6, amount: "100" },
        { decimals: 50, amount: "0.1" },
        { decimals: 100, amount: "0.00000000000000000000000001" },
        { decimals: 0, amount: "30" },
        { decimals: 2, amount: "0.01" },
      ]
      await Promise.all(testEntries.map(({ decimals, amount }) => testManualDeposits(decimals, amount)))
    })
    const testAutomaticDeposits = async function (tradeInfo, expectedDistribution) {
      const {
        numBrackets,
        lowestLimit,
        highestLimit,
        currentPrice,
        amountQuoteToken,
        amountbaseToken,
        quoteTokenInfo,
        baseTokenInfo,
      } = tradeInfo
      const { decimals: quoteTokenDecimals, symbol: quoteTokenSymbol } = quoteTokenInfo
      const { decimals: baseTokenDecimals, symbol: baseTokenSymbol } = baseTokenInfo
      const { bracketsWithQuoteTokenDeposit, bracketsWithbaseTokenDeposit } = expectedDistribution
      assert.equal(
        bracketsWithQuoteTokenDeposit + bracketsWithbaseTokenDeposit,
        numBrackets,
        "Malformed test case, sum of expected distribution should be equal to the fleet size"
      )

      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, numBrackets)

      //Create  quoteToken and add it to the exchange
      const { id: quoteTokenId, token: quoteToken } = await addCustomMintableTokenToExchange(
        exchange,
        quoteTokenSymbol,
        quoteTokenDecimals,
        accounts[0]
      )
      const depositAmountQuoteToken = toErc20Units(amountQuoteToken, quoteTokenDecimals)
      await quoteToken.mint(masterSafe.address, depositAmountQuoteToken, { from: accounts[0] })

      //Create  baseToken and add it to the exchange
      const { id: baseTokenId, token: baseToken } = await addCustomMintableTokenToExchange(
        exchange,
        baseTokenSymbol,
        baseTokenDecimals,
        accounts[0]
      )
      const depositAmountbaseToken = toErc20Units(amountbaseToken, baseTokenDecimals)
      await baseToken.mint(masterSafe.address, depositAmountbaseToken, { from: accounts[0] })

      // Build orders
      const orderTransaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        baseTokenId,
        quoteTokenId,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, orderTransaction)

      // Make transfers
      const batchTransaction = await buildTransferApproveDepositFromOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken.address,
        quoteToken.address,
        lowestLimit,
        highestLimit,
        currentPrice,
        depositAmountQuoteToken,
        depositAmountbaseToken
      )
      await execTransaction(masterSafe, safeOwner.privateKey, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)

      for (const bracketAddress of bracketAddresses) {
        await checkCorrectnessOfDeposits(
          currentPrice,
          bracketAddress,
          exchange,
          quoteToken,
          baseToken,
          bracketsWithQuoteTokenDeposit == 0 ? 0 : depositAmountQuoteToken.div(new BN(bracketsWithQuoteTokenDeposit)),
          bracketsWithbaseTokenDeposit == 0 ? 0 : depositAmountbaseToken.div(new BN(bracketsWithbaseTokenDeposit))
        )
      }
    }
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p > 1", async () => {
      const tradeInfo = {
        numBrackets: 4,
        lowestLimit: 100,
        highestLimit: 121,
        currentPrice: 110,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "WETH" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 2,
        bracketsWithbaseTokenDeposit: 2,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p > 1, numBrackets = 1", async () => {
      const tradeInfo = {
        numBrackets: 1,
        lowestLimit: 100,
        highestLimit: 121,
        currentPrice: 110,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "WETH" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 1,
        bracketsWithbaseTokenDeposit: 0,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p > 1, numBrackets = 19", async () => {
      const tradeInfo = {
        numBrackets: 19,
        lowestLimit: 100,
        highestLimit: 121,
        currentPrice: 120,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "WETH" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 18,
        bracketsWithbaseTokenDeposit: 1,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p > 1 and wide brackets", async () => {
      const tradeInfo = {
        numBrackets: 4,
        lowestLimit: 25,
        highestLimit: 400,
        currentPrice: 100,
        amountQuoteToken: "1",
        amountbaseToken: "2",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "WETH" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 2,
        bracketsWithbaseTokenDeposit: 2,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p < 1", async () => {
      const tradeInfo = {
        numBrackets: 4,
        lowestLimit: 0.09,
        highestLimit: 0.12,
        currentPrice: 0.105,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "WETH" },
        baseTokenInfo: { decimals: 18, symbol: "DAI" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 2,
        bracketsWithbaseTokenDeposit: 2,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic, p<1 && p>1", async () => {
      const tradeInfo = {
        numBrackets: 4,
        lowestLimit: 0.8,
        highestLimit: 1.2,
        currentPrice: 0.9,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "sUSD" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 1,
        bracketsWithbaseTokenDeposit: 3,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic with currentPrice outside of price bounds", async () => {
      const tradeInfo = {
        numBrackets: 4,
        lowestLimit: 0.8,
        highestLimit: 1.2,
        currentPrice: 0.7,
        amountQuoteToken: "0.000000000000001",
        amountbaseToken: "0.000000000000002",
        quoteTokenInfo: { decimals: 18, symbol: "DAI" },
        baseTokenInfo: { decimals: 18, symbol: "sUSD" },
      }
      const expectedDistribution = {
        bracketsWithQuoteTokenDeposit: 0,
        bracketsWithbaseTokenDeposit: 4,
      }
      await testAutomaticDeposits(tradeInfo, expectedDistribution)
    })
    describe("can use automatic deposits to transfer tokens with arbitrary amount of decimals", () => {
      const tokenSetups = [
        {
          amountQuoteToken: "10000",
          amountbaseToken: "100",
          quoteTokenInfo: { decimals: 6, symbol: "USDC" },
          baseTokenInfo: { decimals: 18, symbol: "WETH" },
        },
        {
          amountQuoteToken: "100",
          amountbaseToken: "10000",
          quoteTokenInfo: { decimals: 18, symbol: "WETH" },
          baseTokenInfo: { decimals: 6, symbol: "USDC" },
        },
        {
          amountQuoteToken: "3333",
          amountbaseToken: "100.000001",
          quoteTokenInfo: { decimals: 0, symbol: "nodecimals" },
          baseTokenInfo: { decimals: 6, symbol: "USDC" },
        },
        {
          amountQuoteToken: "0.00000000000000000000001",
          amountbaseToken: "3.14159265",
          quoteTokenInfo: { decimals: 40, symbol: "manydecimals" }, // above 38 decimals one token unit does not fit a uint128
          baseTokenInfo: { decimals: 8, symbol: "WBTC" },
        },
      ]
      it("when p is in the middle of the brackets", async () => {
        const tradeInfoWithoutTokens = {
          numBrackets: 4,
          lowestLimit: 100,
          highestLimit: 121,
          currentPrice: 110,
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 2,
          bracketsWithbaseTokenDeposit: 2,
        }
        for (const tokenSetup of tokenSetups) {
          const tradeInfo = { ...JSON.parse(JSON.stringify(tradeInfoWithoutTokens)), ...JSON.parse(JSON.stringify(tokenSetup)) }
          await testAutomaticDeposits(tradeInfo, expectedDistribution)
        }
      })
      it("when p is in the middle of the brackets and the steps are wide", async () => {
        const tradeInfoWithoutTokens = {
          numBrackets: 4,
          lowestLimit: 25,
          highestLimit: 400,
          currentPrice: 100,
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 2,
          bracketsWithbaseTokenDeposit: 2,
        }
        for (const tokenSetup of tokenSetups) {
          const tradeInfo = { ...JSON.parse(JSON.stringify(tradeInfoWithoutTokens)), ...JSON.parse(JSON.stringify(tokenSetup)) }
          await testAutomaticDeposits(tradeInfo, expectedDistribution)
        }
      })
      it("when p is not in the middle but still inside the brackets", async () => {
        const tradeInfoWithoutTokens = {
          numBrackets: 8,
          lowestLimit: 100,
          highestLimit: 130,
          currentPrice: 110,
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 3,
          bracketsWithbaseTokenDeposit: 5,
        }
        for (const tokenSetup of tokenSetups) {
          const tradeInfo = { ...JSON.parse(JSON.stringify(tradeInfoWithoutTokens)), ...JSON.parse(JSON.stringify(tokenSetup)) }
          await testAutomaticDeposits(tradeInfo, expectedDistribution)
        }
      })
      it("when p is outside the brackets and only quote token is deposited", async () => {
        const tradeInfoWithoutTokens = {
          numBrackets: 4,
          lowestLimit: 100,
          highestLimit: 130,
          currentPrice: 150,
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 4,
          bracketsWithbaseTokenDeposit: 0,
        }
        for (const tokenSetup of tokenSetups) {
          const tradeInfo = { ...JSON.parse(JSON.stringify(tradeInfoWithoutTokens)), ...JSON.parse(JSON.stringify(tokenSetup)) }
          await testAutomaticDeposits(tradeInfo, expectedDistribution)
        }
      })
      it("when p is outside the brackets and only base token is deposited", async () => {
        const tradeInfoWithoutTokens = {
          numBrackets: 4,
          lowestLimit: 100,
          highestLimit: 130,
          currentPrice: 80,
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 0,
          bracketsWithbaseTokenDeposit: 4,
        }
        for (const tokenSetup of tokenSetups) {
          const tradeInfo = { ...JSON.parse(JSON.stringify(tradeInfoWithoutTokens)), ...JSON.parse(JSON.stringify(tokenSetup)) }
          await testAutomaticDeposits(tradeInfo, expectedDistribution)
        }
      })
      it("with extreme prices and decimals", async () => {
        const tradeInfo = {
          numBrackets: 4,
          lowestLimit: 5e194,
          highestLimit: 20e194,
          currentPrice: 10e194,
          amountQuoteToken: "10",
          amountbaseToken: fromErc20Units(new BN("5000000"), 200),
          quoteTokenInfo: { decimals: 3, symbol: "fewdecimals" },
          baseTokenInfo: { decimals: 200, symbol: "manydecimals" },
        }
        const expectedDistribution = {
          bracketsWithQuoteTokenDeposit: 2,
          bracketsWithbaseTokenDeposit: 2,
        }
        await testAutomaticDeposits(tradeInfo, expectedDistribution)
      })
    })
  })

  describe("bracket order placement test:", async function () {
    it("Places bracket orders on behalf of a fleet of safes and checks for profitability and validity", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 90
      const highestLimit = 120
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })

      const currentBatch = (await exchange.getCurrentBatchId.call()).toNumber()
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken,
        quoteToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      // Correctness assertions
      for (const bracketAddress of bracketAddresses) {
        const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements

        // Checks that bracket orders are profitable for liquidity provider
        const initialAmount = toErc20Units(1, 18)
        const amountAfterSelling = initialAmount.mul(sellOrder.priceNumerator).div(sellOrder.priceDenominator)
        const amountAfterBuying = amountAfterSelling.mul(buyOrder.priceNumerator).div(buyOrder.priceDenominator)
        assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")

        assert.equal(buyOrder.validUntil, DEFAULT_ORDER_EXPIRY, `Got ${sellOrder}`)
        assert.equal(sellOrder.validUntil, DEFAULT_ORDER_EXPIRY, `Got ${sellOrder}`)
        assert.equal(buyOrder.validFrom, currentBatch)
        assert.equal(buyOrder.validFrom, currentBatch)
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks for profitability and validity, numBrackets = 1", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 1)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 90
      const highestLimit = 120
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })

      const currentBatch = (await exchange.getCurrentBatchId.call()).toNumber()
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken,
        quoteToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      // Correctness assertions
      for (const bracketAddress of bracketAddresses) {
        const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements

        // Checks that bracket orders are profitable for liquidity provider
        const initialAmount = toErc20Units(1, 18)
        const amountAfterSelling = initialAmount.mul(sellOrder.priceNumerator).div(sellOrder.priceDenominator)
        const amountAfterBuying = amountAfterSelling.mul(buyOrder.priceNumerator).div(buyOrder.priceDenominator)
        assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")

        assert.equal(buyOrder.validUntil, DEFAULT_ORDER_EXPIRY, `Got ${buyOrder}`)
        assert.equal(sellOrder.validUntil, DEFAULT_ORDER_EXPIRY, `Got ${sellOrder}`)
        assert.equal(buyOrder.validFrom, currentBatch)
        assert.equal(buyOrder.validFrom, currentBatch)
      }
    })
    it("Places bracket orders and checks explicitly the expiry", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 90
      const highestLimit = 120
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })
      const customExpiry = (await exchange.getCurrentBatchId.call()).toNumber() + 50
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        baseToken,
        quoteToken,
        lowestLimit,
        highestLimit,
        false,
        customExpiry
      )
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      // Correctness assertions
      for (const bracketAddress of bracketAddresses) {
        const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements
        assert.equal(buyOrder.validUntil, customExpiry, `Got ${buyOrder}`)
        assert.equal(sellOrder.validUntil, customExpiry, `Got ${sellOrder}`)
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks price for p< 1", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 5)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 0.09
      const highestLimit = 0.12
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
      // Check that unlimited orders are being used
      for (const bracketAddress of bracketSafes) {
        const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
        const [buyOrder, sellOrder] = auctionElements
        assert(buyOrder.priceNumerator.eq(MAXUINT128))
        assert(sellOrder.priceDenominator.eq(MAXUINT128))
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 80
      const highestLimit = 110
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
      // Check that unlimited orders are being used
      for (const bracketAddress of bracketSafes) {
        const auctionElements = exchangeUtils.decodeOrders(await exchange.getEncodedUserOrders(bracketAddress))
        assert.equal(auctionElements.length, 2)
        const [buyOrder, sellOrder] = auctionElements
        assert(buyOrder.priceDenominator.eq(MAXUINT128))
        assert(sellOrder.priceNumerator.eq(MAXUINT128))
      }
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p<1, with different decimals than 18", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      testToken = await TestToken.new("TEST6", 6)
      const testToken2 = await TestToken.new("TEST4", 4)
      const baseToken = 2 // "TEST4"
      const quoteToken = 1 // "TEST6"
      const lowestLimit = 0.8
      const highestLimit = 1.1
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken2.address, { from: accounts[0] })
      await exchange.tokenIdToAddressMap.call(2)
      const transaction = await buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1, with different decimals than 18", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      testToken = await TestToken.new("TEST6", 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // "TEST6"
      const lowestLimit = 80
      const highestLimit = 110
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
    it("Places bracket orders on behalf of a fleet of safes and checks prices for p>1 && p<1", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 0.8
      const highestLimit = 1.1
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      const transaction = await buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      await checkPricesOfBracketStrategy(lowestLimit, highestLimit, bracketSafes, exchange)
    })
    it("Failing when lowest limit is higher than highest limit", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketSafes = await deployFleetOfSafes(masterSafe.address, 6)
      const baseToken = 0 // ETH
      const quoteToken = 1 // DAI
      const lowestLimit = 120
      const highestLimit = 90
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(testToken.address, { from: accounts[0] })

      await assertNodejs.rejects(
        buildOrders(masterSafe.address, bracketSafes, baseToken, quoteToken, lowestLimit, highestLimit),
        {
          name: "AssertionError [ERR_ASSERTION]",
          message: "Lowest limit must be lower than highest limit",
        }
      )
    })
  })

  describe("Test withdrawals", async function () {
    const setupAndRequestWithdraw = async function (masterSafe, bracketAddresses, deposits, withdrawals) {
      const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)

      await execTransaction(masterSafe, safeOwner.privateKey, batchTransaction)
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
      await execTransaction(masterSafe, safeOwner.privateKey, requestWithdrawalTransaction)
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
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = toErc20Units(200, 18)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map((bracketAddress) => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map((deposit) => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      // withdrawalsModified has the original withdraw amounts plus an extra. It is used to test
      // that extra amounts are ignored by the script and just the maximal possible value is withdrawn
      const withdrawalsModified = withdrawals
      withdrawalsModified.map((withdraw) => {
        withdraw.amount = withdraw.amount.add(toErc20Units(1, 18))
        withdraw
      })
      const withdrawalTransaction = await buildWithdraw(masterSafe.address, withdrawalsModified)

      await execTransaction(masterSafe, safeOwner.privateKey, withdrawalTransaction, "withdraw for all brackets")

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

      await execTransaction(masterSafe, safeOwner.privateKey, transferFundsToMasterTransaction)

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
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const depositAmount = toErc20Units(200, 18)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map((bracketAddress) => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map((deposit) => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      const withdrawAndTransferFundsToMasterTransaction = await buildWithdrawAndTransferFundsToMaster(
        masterSafe.address,
        withdrawals
      )
      await execTransaction(masterSafe, safeOwner.privateKey, withdrawAndTransferFundsToMasterTransaction)

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
