const TokenOWL = artifacts.require("TokenOWL")
const TestToken = artifacts.require("DetailedMintableToken")

const { toErc20Units } = require("../scripts/utils/printing_tools")
const { ZERO_ADDRESS } = require("../scripts/utils/constants")

const prepareTokenRegistration = async function (account, exchange) {
  const owlToken = await TokenOWL.at(await exchange.feeToken())
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
  let logs = transaction.logs
  if (eventName != null) {
    logs = logs.filter((l) => l.event === eventName && l.address === contractAddress)
  }
  assert.equal(logs.length, 1, "too many logs found!")
  return logs[0].args[paramName]
}

const createTokenAndGetData = async function (symbol, decimals) {
  const tokenData = {
    decimals: decimals,
    symbol: symbol,
  }
  const token = await TestToken.new(symbol, decimals)
  tokenData.address = token.address
  tokenData.instance = token
  return { address: token.address, tokenData: tokenData }
}

module.exports = {
  deploySafe,
  createTokenAndGetData,
  prepareTokenRegistration,
  addCustomMintableTokenToExchange,
}
