const Contract = require("@truffle/contract")
const fs = require("fs")

const { deployFleetOfSafes, buildTransferApproveDepositFromOrders, buildOrders } = require("../utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { toErc20Units } = require("../utils/printing_tools")
const { execTransaction } = require("../utils/internals")(web3, artifacts)

const BatchExchange = artifacts.require("BatchExchange")
const ERC20 = artifacts.require("ERC20Detailed")
const MintableToken = artifacts.require("DetailedMintableToken")
const { addCustomMintableTokenToExchange, deploySafe } = require("../../test/test_utils")

const testAutomaticDeposits = async function (tradeInfo, safeOwner, artifacts = artifacts) {
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
  const GnosisSafe = artifacts.require("GnosisSafe")
  const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
  const gnosisSafeMasterCopy = await GnosisSafe.new()
  const proxyFactory = await ProxyFactory.new()
  const exchange = await BatchExchange.deployed()
  const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
  const bracketAddresses = await deployFleetOfSafes(masterSafe.address, numBrackets)
  //Create  quoteToken and add it to the exchange
  const { id: quoteTokenId, token: quoteToken } = await addCustomMintableTokenToExchange(
    exchange,
    quoteTokenSymbol,
    quoteTokenDecimals,
    safeOwner,
    artifacts
  )

  console.log(exchange.address)
  console.log(await exchange.feeToken())
  const depositAmountQuoteToken = toErc20Units(amountQuoteToken, quoteTokenDecimals)
  await quoteToken.mint(masterSafe.address, depositAmountQuoteToken, { from: safeOwner })

  //Create  baseToken and add it to the exchange
  const { id: baseTokenId, token: baseToken } = await addCustomMintableTokenToExchange(
    exchange,
    baseTokenSymbol,
    baseTokenDecimals,
    safeOwner,
    artifacts
  )
  const depositAmountbaseToken = toErc20Units(amountbaseToken, baseTokenDecimals)
  await baseToken.mint(masterSafe.address, depositAmountbaseToken, { from: safeOwner })

  // Build orders
  const orderTransaction = await buildOrders(
    masterSafe.address,
    bracketAddresses,
    baseTokenId,
    quoteTokenId,
    lowestLimit,
    highestLimit,
    exchange
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
    depositAmountbaseToken,
    exchange
  )
  await execTransaction(masterSafe, safeOwner, batchTransaction)
}

module.exports = async (callback, accounts) => {
  const tradeInfo = {
    numBrackets: 2,
    lowestLimit: 100,
    highestLimit: 300,
    currentPrice: 200,
    amountQuoteToken: 10,
    amountbaseToken: 10,
    quoteTokenInfo: { symbol: "DAI", decimals: 18 },
    baseTokenInfo: { symbol: "WETH", decimals: 18 },
  }
  try {
    await testAutomaticDeposits(tradeInfo, await web3.eth.getAccounts().then((accounts) => accounts[0]), artifacts)

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
