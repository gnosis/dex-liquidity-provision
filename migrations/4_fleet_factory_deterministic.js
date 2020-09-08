const GnosisSafeProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const FleetFactoryDeterministic = artifacts.require("./FleetFactoryDeterministic.sol")

module.exports = async function (deployer) {
  await deployer.deploy(FleetFactoryDeterministic, GnosisSafeProxyFactory.address, { gas: 500000 })
}
