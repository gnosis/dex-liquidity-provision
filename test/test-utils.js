const TokenOWL = artifacts.require("TokenOWL")
const { toETH } = require("../scripts/utils/internals")

const prepareTokenRegistration = async function(account, exchange) {
  const owlToken = await TokenOWL.at(await exchange.feeToken())
  await owlToken.setMinter(account)
  await owlToken.mintOWL(account, toETH(10))
  await owlToken.approve(exchange.address, toETH(10))
}

module.exports = {
  prepareTokenRegistration,
}
