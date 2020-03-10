const { deployFleetOfSafes } = require("./utils/trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "int",
    describe: "Address of Gnosis Safe that is going to own the new fleet",
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
    console.log("Master Safe:", argv.masterSafe)
    console.log(`Deploying a fleet of Safes of size ${argv.fleetSize}`)
    const fleet = await deployFleetOfSafes(argv.masterSafe, argv.fleetSize, artifacts, true)
    console.log(" Addresses", fleet.join())
    callback()
  } catch (error) {
    callback(error)
  }
}
