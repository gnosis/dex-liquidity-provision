const { GnosisSafeProxyFactory } = require("../scripts/utils/dependencies")(web3, artifacts)
const FleetFactory = artifacts.require("./FleetFactory.sol")

module.exports = async function (deployer) {
  await deployer.deploy(FleetFactory, GnosisSafeProxyFactory.address, { gas: 500000 })
}
