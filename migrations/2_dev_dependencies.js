const Artifactor = require("@truffle/artifactor")
const migrateBatchExchange = require("@gnosis.pm/dex-contracts/src/migration/PoC_dfusion")
const { GnosisSafe, GnosisSafeProxyFactory, MultiSend } = require("../scripts/utils/dependencies")(web3, artifacts)

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
    await deploySafeContracts(deployer)
  } else {
    // eslint-disable-next-line no-console
    console.log("Not in development, so nothing to do. Current network is %s", network)
  }
}

async function deploySafeContracts(deployer) {
  const artifactor = new Artifactor("node_modules/@gnosis.pm/safe-contracts/build/contracts/")
  await deployer.deploy(GnosisSafe)
  await artifactor.save(GnosisSafe)
  await deployer.deploy(GnosisSafeProxyFactory)
  await artifactor.save(GnosisSafeProxyFactory)
  await deployer.deploy(MultiSend)
  await artifactor.save(MultiSend)
}
