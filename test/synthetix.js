// const BN = require("bn.js")
// const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
// const ERC20 = artifacts.require("ERC20Detailed")
const TokenOWL = artifacts.require("TokenOWL")
const TestToken = artifacts.require("DetailedMintableToken")

const { prepareTokenRegistration } = require("./test-utils")
const { SynthetixJs } = require("synthetix-js")
// // This dependency is probably unnecessesary since its only used once.
// const ethers = require("ethers")

// // These values are the "currencyKey" used by the synthetix protocol
// const sETH = ethers.utils.formatBytes32String("sETH")
// const sUSD = ethers.utils.formatBytes32String("sUSD")

contract("Unsure", function(accounts) {
  let exchange
  let testToken

  beforeEach(async function() {
    testToken = await TestToken.new("TEST", 18)
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })

  describe("Synthetix interaction test", async function() {
    it("Fetches total supply of sUSD", async () => {
      // TODO - deploy develoment version of this.
      const snxjs = new SynthetixJs()
      const totalSUSD = await snxjs.sUSD.totalSupply()

      const totalSUSDSupply = snxjs.utils.formatEther(totalSUSD)
      console.log("sUSDTotalSupply", totalSUSDSupply)
      // TODO - make an assertion here.
      assert(false)
    })

    it.only("Fetches price of sETH (rinkeby)", async () => {
      const snxjs = new SynthetixJs({ networkId: 4 }) // TODO - need to get dev netowrk.
      assert.equal(snxjs.network, "rinkeby")
      const sETHKey = await snxjs.sETH.currencyKey()
      const sETHAddress = await snxjs.Synthetix.synths(sETHKey)

      const exchangeRate = await snxjs.ExchangeRates.rateForCurrency(sETHKey)

      console.log("sETH token Address", sETHAddress)
      console.log("sETH Current Exchange Rate", snxjs.utils.formatEther(exchangeRate))

      // TODO - make an assertion here.
      assert(false)
    })
  })
  describe("Gnosis Protocal interaction test", async function() {
    it("Add token BatchExchange", async () => {
      await prepareTokenRegistration(accounts[0], exchange)

      await exchange.addToken(testToken.address, { from: accounts[0] })
      assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
    })
  })
})
