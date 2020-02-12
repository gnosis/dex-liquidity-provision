const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

module.exports = async function(deployer) {
  await deployer.deploy(GnosisSafe)
  await deployer.deploy(ProxyFactory)
  await deployer.deploy(MultiSend)
}
