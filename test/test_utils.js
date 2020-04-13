const TokenOWL = artifacts.require("TokenOWL")
const TestToken = artifacts.require("DetailedMintableToken")

const { toErc20Units } = require("../scripts/utils/printing_tools")

const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

const prepareTokenRegistration = async function(account, exchange) {
  const owlToken = await TokenOWL.at(await exchange.feeToken())
  await owlToken.setMinter(account)
  await owlToken.mintOWL(account, toErc20Units(10, 18))
  const currentAllowance = await owlToken.allowance(account, exchange.address)
  await owlToken.approve(exchange.address, currentAllowance.add(toErc20Units(10, 18)))
}

const addCustomMintableTokenToExchange = async function(exchange, symbol, decimals, account) {
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

const deploySafe = async function(gnosisSafeMasterCopy, proxyFactory, owners, threshold) {
  const initData = gnosisSafeMasterCopy.contract.methods
    .setup(owners, threshold, ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, 0, ADDRESS_0)
    .encodeABI()
  const transaction = await proxyFactory.createProxy(gnosisSafeMasterCopy.address, initData)
  return getParamFromTxEvent(transaction, "ProxyCreation", "proxy", proxyFactory.address, null)
}

// Need some small adjustments to default implementation for web3js 1.x
async function getParamFromTxEvent(transaction, eventName, paramName, contract, subject) {
  if (subject != null) {
    logGasUsage(subject, transaction)
  }
  let logs = transaction.logs
  if (eventName != null) {
    logs = logs.filter(l => l.event === eventName && l.address === contract)
  }
  assert.equal(logs.length, 1, "too many logs found!")
  return logs[0].args[paramName]
}

function logGasUsage(subject, transactionOrReceipt) {
  const receipt = transactionOrReceipt.receipt || transactionOrReceipt
  console.log("    Gas costs for " + subject + ": " + receipt.gasUsed)
}

const createTokenAndGetData = async function(symbol, decimals) {
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
  getParamFromTxEvent,
  createTokenAndGetData,
  prepareTokenRegistration,
  addCustomMintableTokenToExchange,
}
