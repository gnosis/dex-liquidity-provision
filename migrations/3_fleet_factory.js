const GnosisSafeProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const FleetFactory = artifacts.require("./FleetFactory.sol")
const FleetFactoryDeterministic = artifacts.require("./FleetFactoryDeterministic.sol")

module.exports = async function (deployer) {
  await deployer.deploy(FleetFactory, GnosisSafeProxyFactory.address, { gas: 500000 })
  await deployer.deploy(FleetFactoryDeterministic, GnosisSafeProxyFactory.address, { gas: 500000 })
}
