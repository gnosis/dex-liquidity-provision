const FleetFactory = artifacts.require("FleetFactory")

const argv = require("./utils/default_yargs").option("masterSafe", {
  type: "string",
  describe: "Address of Gnosis Safe owning every bracket",
  demandOption: true,
}).argv

module.exports = async (callback) => {
  try {
    const fleetFactory = await FleetFactory.deployed()
    const events = await fleetFactory.getPastEvents("FleetDeployed", {
      filter: { owner: argv.masterSafe },
      fromBlock: 0,
      toBlock: "latest",
    })
    const bracketsAsObjects = events.map((object) => object.returnValues.fleet)
    const bracketAddresses = [].concat(...bracketsAsObjects)

    // writing the brackets into a csv file
    const createCsvWriter = require("csv-writer").createObjectCsvWriter
    const csvWriter = createCsvWriter({
      path: "./bracket-addresses.csv",
      header: [{ id: "bracketAddress", title: "bracket-address" }],
    })
    const bracketsFormatted = bracketAddresses.map((bracketAddress) => [{ bracketAddress: bracketAddress }])
    const records = [].concat(...bracketsFormatted)
    await csvWriter.writeRecords(records)

    callback()
  } catch (error) {
    callback(error)
  }
}
