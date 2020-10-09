module.exports = function (web3, artifacts) {
  const truffleContract = require("@truffle/contract")
  const Migrations = artifacts.require("Migrations")

  const GnosisSafeBuildInfo = require("@gnosis.pm/safe-contracts/build/contracts/GnosisSafe.json")
  const GnosisSafe = truffleContract(GnosisSafeBuildInfo)
  GnosisSafe.setProvider(web3.currentProvider)
  // Borrow dynamic config from native contract
  GnosisSafe.defaults(Migrations.defaults())
  GnosisSafe.setNetwork(Migrations.network_id)
  return {
    GnosisSafe,
  }
}
