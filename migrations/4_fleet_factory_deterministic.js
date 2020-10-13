const { GnosisSafeProxyFactory } = require("../scripts/utils/dependencies")(web3, artifacts)
const FleetFactoryDeterministic = artifacts.require("./FleetFactoryDeterministic.sol")

module.exports = async function (deployer) {
  const factory = await GnosisSafeProxyFactory.deployed()
  await deployer.deploy(FleetFactoryDeterministic, factory.address, { gas: 500000 })
}
