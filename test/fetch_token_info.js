const TestToken = artifacts.require("DetailedMintableToken")

const { tokenDetail } = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)

contract("FetchTokenInfo", () => {
  describe("tokenDetail", () => {
    it("relies on network for tokens outside list", async () => {
      const token = await TestToken.new("DAI", 18)
      assert.strictEqual(await tokenDetail("symbol", token), "DAI")
      assert.strictEqual(await tokenDetail("decimals", token), 18)
    })
    it("relies on list if token is present there", async () => {
      const saiToken = { constructor: { network_id: 1 }, address: "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359" }
      assert.strictEqual(await tokenDetail("symbol", saiToken), "SAI")
      assert.strictEqual(await tokenDetail("decimals", saiToken), 18)
    })
    it("ignores list if token is present but on another network", async () => {
      const notSaiToken = {
        constructor: { network_id: 4 },
        address: "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359",
        symbol: () => "not SAI",
      }
      assert.strictEqual(await tokenDetail("symbol", notSaiToken), "not SAI")
    })
  })
})
