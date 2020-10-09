const Artifactor = require("@truffle/artifactor")
const migrateBatchExchange = require("@gnosis.pm/dex-contracts/src/migration/PoC_dfusion")
const { GnosisSafe } = require("../scripts/utils/dependencies")(web3, artifacts)
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

  const artifactor = new Artifactor("build/contracts/")
  await artifactor.save(artefact)

  if (network === "development") {
    await deploySafe(deployer)
    await deployer.deploy(ProxyFactory)
    await deployer.deploy(MultiSend)
  } else {
    // eslint-disable-next-line no-console
    console.log("Not in development, so nothing to do. Current network is %s", network)
  }
}

async function deploySafe(deployer) {
  await deployer.deploy(GnosisSafe)
  const artifactor = new Artifactor("node_modules/@gnosis.pm/safe-contracts/build/contracts/")
  await artifactor.save(GnosisSafe)
}
