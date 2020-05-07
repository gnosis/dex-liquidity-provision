const createCsvWriter = require("csv-writer").createObjectCsvWriter
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const { fetchTokenInfoFromExchange, getExchange, getDeployedBrackets } = require("./utils/trading_strategy_helpers")(
  web3,
  artifacts
)

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("outputFile", {
    type: "string",
    describe: "Path and file name for the output of the script",
    demandOption: false,
  }).argv

module.exports = async (callback) => {
  try {
    const bracketAddresses = await getDeployedBrackets(argv.masterSafe)
    console.log("The following addresses have been deployed from your MASTER SAFE: ", bracketAddresses)

    // writing the brackets into a csv file
    const csvWriter = createCsvWriter({
      path: argv.outputFile || "./bracket-addresses.csv",
      header: [
        { id: "Address", title: "Address" },
        { id: "Type", title: "Type" },
        { id: "Description", title: "Description" },
        { id: "Tags", title: "Tags" },
      ],
    })

    const exchange = await getExchange(web3)
    const records = await Promise.all(
      bracketAddresses.map(async (bracketAddress) => {
        const orders = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders.call(bracketAddress))
        let tradingPair
        if (orders.length > 0) {
          const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [orders[0].buyToken, orders[0].sellToken])
          tradingPair =
            (await tokenInfoPromises[orders[0].sellToken]).symbol + " - " + (await tokenInfoPromises[orders[0].buyToken]).symbol
        } else {
          tradingPair = " - not yet defined -"
        }
        return {
          Address: bracketAddress,
          Type: "liquidity",
          Description: "bracket-strategy on the pair " + tradingPair + " controlled by master safe: " + argv.masterSafe,
          Tags: "bracket-strategy",
        }
      })
    )
    await csvWriter.writeRecords(records)

    callback()
  } catch (error) {
    callback(error)
  }
}
