module.exports = function (web3, artifacts) {
  const BN = require("bn.js")
  const { checkCorrectnessOfDeposits } = require("./price_utils")
  const { waitForNSeconds, execTransaction } = require("./internals")(web3, artifacts)
  const { deployFleetOfSafes, buildOrders, buildTransferApproveDepositFromOrders } = require("./trading_strategy_helpers")(
    web3,
    artifacts
  )
  const { ZERO_ADDRESS } = require("./constants")
  const GnosisSafe = artifacts.require("GnosisSafe")
  const TokenOWL = artifacts.require("TokenOWL")
  const TestToken = artifacts.require("DetailedMintableToken")

  const { toErc20Units } = require("./printing_tools")

  const testAutomaticDeposits = async function (
    tradeInfo,
    expectedDistribution,
    gnosisSafeMasterCopy,
    proxyFactory,
    safeOwner,
    exchange,
    accounts
  ) {
    const strategyData = await deployNewStrategy(tradeInfo, gnosisSafeMasterCopy, proxyFactory, safeOwner, exchange, accounts)

    const { numBrackets, currentPrice, amountQuoteToken, amountbaseToken, quoteTokenInfo, baseTokenInfo } = tradeInfo
    const { decimals: quoteTokenDecimals } = quoteTokenInfo
    const { decimals: baseTokenDecimals } = baseTokenInfo
    const depositAmountbaseToken = toErc20Units(amountbaseToken, baseTokenDecimals)
    const depositAmountQuoteToken = toErc20Units(amountQuoteToken, quoteTokenDecimals)

    // Close auction for deposits to be reflected in exchange balance
    await waitForNSeconds(301)

    const { bracketsWithQuoteTokenDeposit, bracketsWithbaseTokenDeposit } = expectedDistribution
    const assert = require("assert")
    assert.equal(
      bracketsWithQuoteTokenDeposit + bracketsWithbaseTokenDeposit,
      numBrackets,
      "Malformed test case, sum of expected distribution should be equal to the fleet size"
    )
    for (const bracketAddress of strategyData.bracketAddresses) {
      await checkCorrectnessOfDeposits(
        currentPrice,
        bracketAddress,
        exchange,
        strategyData.quoteToken,
        strategyData.baseToken,
        bracketsWithQuoteTokenDeposit == 0 ? 0 : depositAmountQuoteToken.div(new BN(bracketsWithQuoteTokenDeposit)),
        bracketsWithbaseTokenDeposit == 0 ? 0 : depositAmountbaseToken.div(new BN(bracketsWithbaseTokenDeposit))
      )
    }
  }

  const deployNewStrategy = async function (tradeInfo, gnosisSafeMasterCopy, proxyFactory, safeOwner, exchange, accounts) {
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

    const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
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
      accounts[0],
      artifacts
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
    await execTransaction(masterSafe, safeOwner, orderTransaction)

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
    await execTransaction(masterSafe, safeOwner, batchTransaction)
    return { bracketAddresses: bracketAddresses, quoteToken: quoteToken, baseToken: baseToken }
  }

  const prepareTokenRegistration = async function (account, exchange) {
    const owlToken = await TokenOWL.at(await exchange.feeToken.call())
    await owlToken.setMinter(account)
    await owlToken.mintOWL(account, toErc20Units(10, 18))
    const currentAllowance = await owlToken.allowance(account, exchange.address)
    await owlToken.approve(exchange.address, currentAllowance.add(toErc20Units(10, 18)))
  }

  const addCustomMintableTokenToExchange = async function (exchange, symbol, decimals, account) {
    // TODO: use this function in all tests creating new tokens
    const tokenPromise = TestToken.new(symbol, decimals)
    await prepareTokenRegistration(account, exchange)
    const token = await tokenPromise
    await exchange.addToken(token.address, { from: account })
    const id = await exchange.tokenAddressToIdMap(token.address)
    return {
      id: id.toNumber(),
      token: token,
    }
  }

  const deploySafe = async function (gnosisSafeMasterCopy, proxyFactory, owners, threshold) {
    const initData = gnosisSafeMasterCopy.contract.methods
      .setup(owners, threshold, ZERO_ADDRESS, "0x", ZERO_ADDRESS, ZERO_ADDRESS, 0, ZERO_ADDRESS)
      .encodeABI()
    const transaction = await proxyFactory.createProxy(gnosisSafeMasterCopy.address, initData)
    return getParamFromTxEvent(transaction, "ProxyCreation", "proxy", proxyFactory.address, null)
  }

  const getParamFromTxEvent = async function (transaction, eventName, paramName, contractAddress) {
    const assert = require("assert")
    let logs = transaction.logs
    if (eventName != null) {
      logs = logs.filter((l) => l.event === eventName && l.address === contractAddress)
    }
    assert.equal(logs.length, 1, "too many logs found!")
    return logs[0].args[paramName]
  }

  return {
    deploySafe,
    prepareTokenRegistration,
    addCustomMintableTokenToExchange,
    testAutomaticDeposits,
    deployNewStrategy,
  }
}
