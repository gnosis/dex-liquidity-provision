const TokenOWL = artifacts.require("TokenOWL")
const { toErc20Units } = require("../scripts/utils/printing_tools")

const prepareTokenRegistration = async function(account, exchange) {
  const owlToken = await TokenOWL.at(await exchange.feeToken())
  await owlToken.setMinter(account)
  await owlToken.mintOWL(account, toErc20Units(10, 18))
  await owlToken.approve(exchange.address, toErc20Units(10, 18))
}

module.exports = {
  prepareTokenRegistration,
}
