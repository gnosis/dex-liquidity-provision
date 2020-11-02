module.exports = function (web3, artifacts) {
  const truffleContract = require("@truffle/contract")
  const Migrations = artifacts.require("Migrations")

  const makeContract = function (buildInfo) {
    const Contract = truffleContract(buildInfo)
    Contract.setProvider(web3.currentProvider)
    // Borrow dynamic config from native contract
    Contract.defaults(Migrations.defaults())
    Contract.setNetwork(Migrations.network_id)
    return Contract
  }

  const BatchExchange = makeContract(require("../../build/contracts/BatchExchange.json"))
  const GnosisSafe = makeContract(require("../../build/contracts/GnosisSafe.json"))
  const GnosisSafeProxyFactory = makeContract(require("../../build/contracts/GnosisSafeProxyFactory.json"))
  const MultiSend = makeContract(require("../../build/contracts/MultiSend.json"))

  return {
    BatchExchange,
    GnosisSafe,
    GnosisSafeProxyFactory,
    MultiSend,
  }
}
