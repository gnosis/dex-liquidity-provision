const { deployFleetOfSafes } = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "int",
    describe: "Address of Gnosis Safe owning slaveSafesoken whose target price is to be specified (i.e. ETH)",
  })
  .option("fleetSize", {
    type: "int",
    describe: "Number of (sub)safes to be deployed",
  })
  .demand(["masterSafe", "fleetSize"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    console.log(`Deploying ${argv.fleetSize} subsafes `)
    console.log("Master Safe:", argv.masterSafe)
    const slaves = await deployFleetOfSafes(argv.masterSafe, argv.fleetSize, artifacts)
    console.log("Slave Addresses", slaves)
    callback()
  } catch (error) {
    callback(error)
  }
}
