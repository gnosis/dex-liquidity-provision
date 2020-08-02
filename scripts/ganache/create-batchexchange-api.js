module.exports = async (callback, accounts) => {
  try {
    const fs = require("fs")
    console.log("current ganache network id: ", await web3.eth.net.getId())
    // destination.txt will be created or overwritten by default.
    // fs.copyFile(
    //   "node_modules/@gnosis.pm/dex-contracts/build/contracts/BatchExchange.json",
    //   "build/contracts/BatchExchange.json",
    //   (err) => {
    //     if (err) throw err
    //     console.log("Created BatchExchange.json")
    //   }
    // )
    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
