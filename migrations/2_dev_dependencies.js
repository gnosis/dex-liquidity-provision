const Artifactor = require("@truffle/artifactor")
const migrateBatchExchange = require("@gnosis.pm/dex-contracts/src/migration/migrate_BatchExchange")
const { BatchExchange, GnosisSafe, GnosisSafeProxyFactory, MultiSend } = require("../scripts/utils/dependencies")(
  web3,
  artifacts
)

module.exports = async function (deployer, network, accounts) {
  if (network === "development") {
    console.log("Migrating Batch Exchange")
    await deployBatchExchangeContracts(deployer, network, accounts[0])
    await deploySafeContracts(deployer)
  } else {
    console.log("Not in development, so nothing to do. Current network is %s", network)
  }
}

/**
 * @param deployer
 * @param network
 * @param account
 */
async function deployBatchExchangeContracts(deployer, network, account) {
  await migrateBatchExchange({
    BatchExchange,
    artifacts,
    deployer,
    network,
    account,
    web3,
  })
  const artifactor = new Artifactor("node_modules/@gnosis.pm/dex-contracts/build/contracts/")
  await artifactor.save(BatchExchange)
}

/**
 * @param deployer
 */
async function deploySafeContracts(deployer) {
  const artifactor = new Artifactor("node_modules/@gnosis.pm/safe-contracts/build/contracts/")
  await deployer.deploy(GnosisSafe)
  await artifactor.save(GnosisSafe)
  await deployer.deploy(GnosisSafeProxyFactory)
  await artifactor.save(GnosisSafeProxyFactory)
  await deployer.deploy(MultiSend)
  await artifactor.save(MultiSend)
}
