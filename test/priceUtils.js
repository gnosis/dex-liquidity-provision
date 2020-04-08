const assert = require("assert")
const { isPriceReasonable } = require("../scripts/utils/price-utils")(web3, artifacts)

contract("PriceOracle", function() {
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const targetTokenData = { symbol: "WETH" }
      const stableTokenData = { symbol: "DAI" }
      assert(await isPriceReasonable(targetTokenData, stableTokenData, price, acceptedPriceDeviationInPercentage))
    })
  })
})
