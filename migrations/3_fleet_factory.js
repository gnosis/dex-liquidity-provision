const GnosisSafeProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const FleetFactory = artifacts.require("./FleetFactory.sol")

module.exports = async function(deployer) {
  await deployer.deploy(FleetFactory, GnosisSafeProxyFactory.address)
}
