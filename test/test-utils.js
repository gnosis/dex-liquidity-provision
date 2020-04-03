const TokenOWL = artifacts.require("TokenOWL")
const TestToken = artifacts.require("DetailedMintableToken")
const { toErc20Units } = require("../scripts/utils/printing_tools")

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
  prepareTokenRegistration,
  addCustomMintableTokenToExchange,
  createTokenAndGetData,
}
