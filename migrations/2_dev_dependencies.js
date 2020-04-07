const migrateBatchExchange = require("@gnosis.pm/dex-contracts/src/migration/PoC_dfusion")
const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

module.exports = async function(deployer, network, accounts) {
  if (network === "development") {
    await migrateBatchExchange({
      artifacts,
      deployer,
      network,
      account: accounts[0],
      web3,
    })
    await deployer.deploy(GnosisSafe)
    await deployer.deploy(ProxyFactory)
    await deployer.deploy(MultiSend)
  } else {
    // eslint-disable-next-line no-console
    console.log("Not in development, so nothing to do. Current network is %s", network)
  }
}
