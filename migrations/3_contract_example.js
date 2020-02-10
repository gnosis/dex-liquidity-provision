const Contract = require("@truffle/contract");

module.exports = async function(deployer, network, accounts) {
  const BatchExchange = Contract(
    require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
  );
  BatchExchange.setProvider(deployer.provider);
  BatchExchange.setNetwork(deployer.network_id);
  batchExchange = await BatchExchange.deployed();
  ContractExample = artifacts.require("ContractExample");
  await deployer.deploy(ContractExample, batchExchange.address);
};
