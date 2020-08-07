const migrateBatchExchange = require("@gnosis.pm/dex-contracts/src/migration/PoC_dfusion")
const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

module.exports = async function (deployer, network, accounts) {
  console.log("Migrating Batch Exchange")
  const artefact = await migrateBatchExchange({
    artifacts,
    deployer,
    network,
    account: accounts[0],
    web3,
  })

  const Artifactor = require("@truffle/artifactor")
  const artifactor = new Artifactor("build/contracts/")
  await artifactor.save(artefact)

  if (network === "development") {
    await deployer.deploy(GnosisSafe)
    await deployer.deploy(ProxyFactory)
    await deployer.deploy(MultiSend)
  } else {
    // eslint-disable-next-line no-console
    console.log("Not in development, so nothing to do. Current network is %s", network)
  }
}
