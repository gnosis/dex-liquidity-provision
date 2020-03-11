const assert = require("assert")
const Contract = require("@truffle/contract")
const { prepareTokenRegistration } = require("./test-utils")
const { isPriceReasonable } = require("../scripts/utils/price-utils")

contract("PriceOracle", function(accounts) {
  describe("Price oracle sanity check", async () => {
    it("checks that the WETH price is above 9", async () => {
      const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

      BatchExchange.setProvider(web3.currentProvider)
      BatchExchange.setNetwork(web3.network_id)
      const exchange = await BatchExchange.deployed()

      const ERC20 = artifacts.require("DetailedMintableToken")
      const token1 = await ERC20.new("WETH", 18)
      const token2 = await ERC20.new("DAI", 18)
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token1.address, { from: accounts[0] })
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token2.address, { from: accounts[0] })
      const targetTokenId = 1
      const stableTokenId = 2
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      assert(await isPriceReasonable(exchange, targetTokenId, stableTokenId, price, acceptedPriceDeviationInPercentage))
    })
  })
})
